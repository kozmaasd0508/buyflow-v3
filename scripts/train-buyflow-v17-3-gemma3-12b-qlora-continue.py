import gc
import hashlib
import json
import random
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset
from peft import PeftModel, prepare_model_for_kbit_training
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

SEED = 17032026
ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
START_ADAPTER = ROOT / "adapters" / "buyflow-v17-gemma3-12b-qlora-r8-v3"
DATA_DIR = Path.home() / "Desktop" / "buyflow-v17-3-large"
TRAIN_FILE = DATA_DIR / "train.jsonl"
VAL_FILE = DATA_DIR / "validation.jsonl"
OUT_DIR = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"

EXPECTED_TRAIN_SHA = "50fb0d02df0e27c02c52763b4740614c354de02896df5494df0b42c1acbeb2bf"
EXPECTED_VAL_SHA = "3586eeab32c1d769f471f6604037350b0daafb88d5df66b716595794fbe2f56c"
EXPECTED_TRAIN_ROWS = 3000
EXPECTED_VAL_ROWS = 400

MAX_LENGTH = 512
EPOCHS = 1
GRAD_ACCUM = 8
LR = 2.0e-5
WEIGHT_DECAY = 0.01
MAX_GRAD_NORM = 1.0
LOG_EVERY = 100
CHECKPOINT_EVERY = 500


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_jsonl(path: Path):
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def split_messages(messages):
    system = ""
    user = ""
    assistant = None
    for m in messages:
        role = m.get("role")
        content = str(m.get("content", ""))
        if role == "system":
            system = content
        elif role == "user":
            user = content
        elif role == "assistant":
            assistant = content
    if assistant is None:
        raise ValueError("Training row has no assistant target")
    user_text = (system + "\n\n" + user).strip() if system else user
    return user_text, assistant


class BuyFlowDataset(Dataset):
    def __init__(self, rows, tokenizer, name):
        self.items = []
        self.max_raw = 0
        self.truncated = 0
        self.min_target = 10**9
        self.max_target = 0

        for row in rows:
            row_id = row.get("id", "unknown")
            user_text, answer = split_messages(row["messages"])
            user_msgs = [{"role": "user", "content": user_text}]
            full_msgs = [
                {"role": "user", "content": user_text},
                {"role": "assistant", "content": answer},
            ]

            prompt_text = tokenizer.apply_chat_template(
                user_msgs, tokenize=False, add_generation_prompt=True
            )
            full_text = tokenizer.apply_chat_template(
                full_msgs, tokenize=False, add_generation_prompt=False
            )
            if not full_text.startswith(prompt_text):
                raise RuntimeError(
                    f"Rendered chat prefix mismatch in row {row_id}; refusing to guess assistant boundary"
                )

            target_text = full_text[len(prompt_text):]
            if not target_text.strip():
                raise RuntimeError(f"Empty assistant target in row {row_id}")

            prompt_ids = tokenizer.encode(prompt_text, add_special_tokens=False)
            target_ids = tokenizer.encode(target_text, add_special_tokens=False)
            if not target_ids:
                raise RuntimeError(f"No assistant target tokens in row {row_id}")

            self.min_target = min(self.min_target, len(target_ids))
            self.max_target = max(self.max_target, len(target_ids))
            raw_len = len(prompt_ids) + len(target_ids)
            self.max_raw = max(self.max_raw, raw_len)

            if len(target_ids) >= MAX_LENGTH:
                raise RuntimeError(
                    f"Assistant target too long in row {row_id}: {len(target_ids)} tokens"
                )

            keep_prompt = MAX_LENGTH - len(target_ids)
            if len(prompt_ids) > keep_prompt:
                self.truncated += 1
                prompt_ids = prompt_ids[-keep_prompt:] if keep_prompt > 0 else []

            input_ids = prompt_ids + target_ids
            labels = ([-100] * len(prompt_ids)) + target_ids
            if len(input_ids) > MAX_LENGTH or len(labels) != len(input_ids):
                raise RuntimeError(f"Encoding length error in row {row_id}")
            if not any(x != -100 for x in labels):
                raise RuntimeError(f"No supervised target in row {row_id}")

            self.items.append({
                "input_ids": torch.tensor(input_ids, dtype=torch.long),
                "attention_mask": torch.ones(len(input_ids), dtype=torch.long),
                "labels": torch.tensor(labels, dtype=torch.long),
            })

        print(
            f"{name} ENCODING: PASS | rows={len(self.items)} | max_raw={self.max_raw} | "
            f"truncated={self.truncated} | assistant_tokens={self.min_target}..{self.max_target}"
        )

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        return self.items[idx]


def make_collator(tokenizer):
    pad_id = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id

    def collate(batch):
        max_len = max(x["input_ids"].numel() for x in batch)
        ids, masks, labels = [], [], []
        for x in batch:
            n = x["input_ids"].numel()
            pad = max_len - n
            ids.append(torch.cat([x["input_ids"], torch.full((pad,), pad_id, dtype=torch.long)]))
            masks.append(torch.cat([x["attention_mask"], torch.zeros(pad, dtype=torch.long)]))
            labels.append(torch.cat([x["labels"], torch.full((pad,), -100, dtype=torch.long)]))
        return {
            "input_ids": torch.stack(ids),
            "attention_mask": torch.stack(masks),
            "labels": torch.stack(labels),
        }

    return collate


def to_device(batch):
    return {k: v.to("cuda", non_blocking=False) for k, v in batch.items()}


def eval_loss(model, loader):
    model.eval()
    vals = []
    with torch.no_grad():
        for batch in loader:
            batch = to_device(batch)
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                out = model(**batch)
            vals.append(float(out.loss.detach().cpu()))
            del batch, out
    model.train()
    return sum(vals) / max(1, len(vals))


def main():
    random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    print("==============================================================")
    print("BUYFLOW V17.3 - GEMMA 3 12B QLORA CONTINUATION")
    print("Start adapter: buyflow-v17-gemma3-12b-qlora-r8-v3")
    print("Train: 3000 | Validation: 400")
    print("External Blind V2: UNTOUCHED")
    print("Quantization: 4-bit NF4 + double quant + BF16 compute")
    print("Continuation: 1 epoch | batch=1 | grad_accum=8 | lr=2e-5")
    print("Production: OFF")
    print("==============================================================")

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU is not visible to PyTorch")
    for p in (MODEL_DIR, START_ADAPTER, TRAIN_FILE, VAL_FILE):
        if not p.exists():
            raise RuntimeError(f"Required path missing: {p}")

    train_sha = sha256_file(TRAIN_FILE)
    val_sha = sha256_file(VAL_FILE)
    print(f"train sha256:      {train_sha}")
    print(f"validation sha256: {val_sha}")
    if train_sha != EXPECTED_TRAIN_SHA:
        raise RuntimeError("train.jsonl hash mismatch; refusing to train")
    if val_sha != EXPECTED_VAL_SHA:
        raise RuntimeError("validation.jsonl hash mismatch; refusing to train")

    train_rows = read_jsonl(TRAIN_FILE)
    val_rows = read_jsonl(VAL_FILE)
    if len(train_rows) != EXPECTED_TRAIN_ROWS or len(val_rows) != EXPECTED_VAL_ROWS:
        raise RuntimeError(f"Unexpected counts: train={len(train_rows)} val={len(val_rows)}")

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("\nValidating assistant boundaries for ALL 3400 rows before model load...")
    train_ds = BuyFlowDataset(train_rows, tokenizer, "TRAIN")
    val_ds = BuyFlowDataset(val_rows, tokenizer, "VALIDATION")
    print("DATASET MASKING PRECHECK: PASS | 3400/3400")

    collate = make_collator(tokenizer)
    generator = torch.Generator().manual_seed(SEED)
    train_loader = DataLoader(train_ds, batch_size=1, shuffle=True, collate_fn=collate, generator=generator)
    val_loader = DataLoader(val_ds, batch_size=1, shuffle=False, collate_fn=collate)

    qconfig = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    print("\nLoading cached 4-bit Gemma base...")
    torch.cuda.empty_cache()
    base = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
        local_files_only=True,
    )
    base.config.use_cache = False
    base.train()
    base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=True)

    print("Loading existing V17 LoRA adapter as TRAINABLE continuation...")
    model = PeftModel.from_pretrained(
        base,
        str(START_ADAPTER),
        is_trainable=True,
        local_files_only=True,
    )
    model.train()
    model.config.use_cache = False

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    if trainable <= 0:
        raise RuntimeError("Continuation adapter loaded but no trainable parameters found")
    print(f"CONTINUATION LOAD: PASS | trainable={trainable:,} | model_params={total:,}")

    optimizer = torch.optim.AdamW(
        (p for p in model.parameters() if p.requires_grad),
        lr=LR,
        betas=(0.9, 0.999),
        eps=1e-8,
        weight_decay=WEIGHT_DECAY,
    )

    longest_idx = max(range(len(train_ds)), key=lambda i: train_ds[i]["input_ids"].numel())
    pre_batch = to_device(collate([train_ds[longest_idx]]))
    print("\nRunning longest-row backward/OOM preflight...")
    optimizer.zero_grad(set_to_none=True)
    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
        pre_out = model(**pre_batch)
        pre_loss = pre_out.loss
    if not torch.isfinite(pre_loss):
        raise RuntimeError(f"Non-finite preflight loss: {pre_loss}")
    pre_loss.backward()
    optimizer.zero_grad(set_to_none=True)
    print(
        f"PRECHECK: PASS | loss={float(pre_loss.detach().cpu()):.4f} | "
        f"allocated={torch.cuda.memory_allocated(0)/1024**3:.2f} GB | "
        f"reserved={torch.cuda.memory_reserved(0)/1024**3:.2f} GB"
    )
    del pre_batch, pre_out, pre_loss
    gc.collect()
    torch.cuda.empty_cache()

    print("\nMeasuring initial V17.3 validation loss...")
    initial_val = eval_loss(model, val_loader)
    print(f"Initial validation loss: {initial_val:.6f}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    optimizer.zero_grad(set_to_none=True)
    running = 0.0
    seen = 0
    optimizer_steps = 0
    start = time.time()

    for i, batch in enumerate(train_loader, start=1):
        batch = to_device(batch)
        with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
            out = model(**batch)
            loss = out.loss
            if not torch.isfinite(loss):
                raise RuntimeError(f"Non-finite loss at row={i}: {loss}")
            scaled = loss / GRAD_ACCUM
        scaled.backward()
        running += float(loss.detach().cpu())
        seen += 1

        if i % GRAD_ACCUM == 0 or i == len(train_loader):
            torch.nn.utils.clip_grad_norm_(
                [p for p in model.parameters() if p.requires_grad], MAX_GRAD_NORM
            )
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            optimizer_steps += 1

        if i % LOG_EVERY == 0 or i == len(train_loader):
            elapsed = time.time() - start
            print(
                f"epoch 1/1 | {i}/{len(train_loader)} | train_loss={running/seen:.6f} | "
                f"opt_steps={optimizer_steps} | elapsed={elapsed/60:.1f} min | "
                f"vram_alloc={torch.cuda.memory_allocated(0)/1024**3:.2f}GB"
            )

        if i % CHECKPOINT_EVERY == 0 and i < len(train_loader):
            ckpt = OUT_DIR / f"checkpoint-{i}"
            model.save_pretrained(ckpt)
            print(f"CHECKPOINT SAVED: {ckpt}")

        del batch, out, loss, scaled

    train_avg = running / max(1, seen)
    print("\nMeasuring final V17.3 validation loss...")
    final_val = eval_loss(model, val_loader)
    elapsed = time.time() - start

    model.save_pretrained(OUT_DIR)
    tokenizer.save_pretrained(OUT_DIR)

    summary = {
        "run": "buyflow-v17-3-gemma3-12b-qlora-r8-cont1",
        "base_model": "google/gemma-3-12b-it",
        "starting_adapter": str(START_ADAPTER),
        "output_adapter": str(OUT_DIR),
        "train_rows": len(train_rows),
        "validation_rows": len(val_rows),
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "external_blind_v2_touched": False,
        "epochs": EPOCHS,
        "grad_accum": GRAD_ACCUM,
        "learning_rate": LR,
        "train_loss": train_avg,
        "initial_validation_loss": initial_val,
        "final_validation_loss": final_val,
        "optimizer_steps": optimizer_steps,
        "elapsed_seconds": round(elapsed, 1),
        "trainable_params": trainable,
        "model_params_seen": total,
        "gpu": torch.cuda.get_device_name(0),
        "vram_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2),
        "production": "OFF",
    }
    (OUT_DIR / "training-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print("\n==============================================================")
    print("BUYFLOW V17.3 QLORA CONTINUATION: COMPLETE")
    print(f"Adapter: {OUT_DIR}")
    print(f"Train loss:          {train_avg:.6f}")
    print(f"Initial val loss:    {initial_val:.6f}")
    print(f"Final val loss:      {final_val:.6f}")
    print(f"Optimizer steps:     {optimizer_steps}")
    print(f"Elapsed:             {elapsed/60:.1f} min")
    print("External Blind V2: UNTOUCHED")
    print("Production: OFF")
    print("==============================================================")


if __name__ == "__main__":
    main()
