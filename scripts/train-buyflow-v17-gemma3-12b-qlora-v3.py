import gc
import hashlib
import json
import random
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

SEED = 17012026
ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
DATA_DIR = Path.home() / "Desktop" / "buyflow-v17-teacher-dataset"
TRAIN_FILE = DATA_DIR / "train.jsonl"
VAL_FILE = DATA_DIR / "validation.jsonl"
OUT_DIR = ROOT / "adapters" / "buyflow-v17-gemma3-12b-qlora-r8-v3"

EXPECTED_TRAIN_SHA = "ed51f1c00ea46af2e4c146d92f808c2dadf23d1dfcbc23174c729b3455a6a4e0"
EXPECTED_VAL_SHA = "5d2ec9762dff741d2cee6a14ada276214db1abdf603bb05da3558c79728a15a9"
EXPECTED_TRAIN_ROWS = 240
EXPECTED_VAL_ROWS = 30

MAX_LENGTH = 512
EPOCHS = 3
GRAD_ACCUM = 8
LR = 1.0e-4
WEIGHT_DECAY = 0.01
MAX_GRAD_NORM = 1.0


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
    """Render the Gemma prompt as text, then tokenize prompt and target separately.

    This avoids guessing the assistant boundary from two independently tokenized
    chat-template sequences. If truncation is needed, only prompt tokens are
    removed; assistant target tokens are never discarded.
    """

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
                user_msgs,
                tokenize=False,
                add_generation_prompt=True,
            )
            full_text = tokenizer.apply_chat_template(
                full_msgs,
                tokenize=False,
                add_generation_prompt=False,
            )

            if not full_text.startswith(prompt_text):
                raise RuntimeError(
                    f"Rendered chat prefix mismatch in row {row_id}; refusing to guess assistant boundary"
                )

            target_text = full_text[len(prompt_text):]
            if not target_text.strip():
                raise RuntimeError(f"Empty rendered assistant target in row {row_id}")

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
                    f"Assistant target itself is too long in row {row_id}: {len(target_ids)} tokens"
                )

            keep_prompt = MAX_LENGTH - len(target_ids)
            if len(prompt_ids) > keep_prompt:
                self.truncated += 1
                prompt_ids = prompt_ids[-keep_prompt:] if keep_prompt > 0 else []

            input_ids = prompt_ids + target_ids
            labels = ([-100] * len(prompt_ids)) + target_ids

            if len(input_ids) > MAX_LENGTH:
                raise RuntimeError(f"Internal length error in row {row_id}: {len(input_ids)}")
            if len(labels) != len(input_ids):
                raise RuntimeError(f"Label length mismatch in row {row_id}")
            target_count = sum(1 for x in labels if x != -100)
            if target_count != len(target_ids) or target_count <= 0:
                raise RuntimeError(f"Assistant masking error in row {row_id}")

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
    pad_id = tokenizer.pad_token_id
    if pad_id is None:
        pad_id = tokenizer.eos_token_id

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
    print("BUYFLOW V17 - GEMMA 3 12B QLORA TRAINING V3")
    print("Base model: google/gemma-3-12b-it")
    print("Train: 240 | Validation: 30 | External Blind V2: UNTOUCHED")
    print("Assistant masking: rendered-text boundary, no token-prefix guessing")
    print("Quantization: 4-bit NF4 + double quant + BF16 compute")
    print("LoRA: text layers only | r=8 | alpha=16")
    print("Batch: 1 | grad accumulation: 8 | epochs: 3 | lr: 1e-4")
    print("Production: OFF")
    print("==============================================================")

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU is not visible to PyTorch")
    if not MODEL_DIR.exists():
        raise RuntimeError(f"Local Gemma model missing: {MODEL_DIR}")
    for p in (TRAIN_FILE, VAL_FILE):
        if not p.exists():
            raise RuntimeError(f"Dataset file missing: {p}")

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
        raise RuntimeError(f"Unexpected dataset counts: train={len(train_rows)} val={len(val_rows)}")

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("\nValidating assistant boundaries for ALL 270 rows before model load...")
    train_ds = BuyFlowDataset(train_rows, tokenizer, "TRAIN")
    val_ds = BuyFlowDataset(val_rows, tokenizer, "VALIDATION")
    print("DATASET MASKING PRECHECK: PASS | 270/270")

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

    print("\nLoading cached 4-bit Gemma on GPU...")
    torch.cuda.empty_cache()
    model = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
        local_files_only=True,
    )
    model.config.use_cache = False
    model.train()
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)

    suffixes = ("q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj")
    target_modules = []
    for name, _module in model.named_modules():
        if name.endswith(suffixes) and "vision" not in name.lower():
            target_modules.append(name)
    if not target_modules:
        raise RuntimeError("No text LoRA target modules discovered")
    print(f"Text LoRA target modules discovered: {len(target_modules)}")

    lora = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
        target_modules=target_modules,
    )
    model = get_peft_model(model, lora)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"LoRA trainable params: {trainable:,}")
    print(f"Model params seen:     {total:,}")

    optimizer = torch.optim.AdamW(
        (p for p in model.parameters() if p.requires_grad),
        lr=LR,
        betas=(0.9, 0.999),
        eps=1e-8,
        weight_decay=WEIGHT_DECAY,
    )

    longest_idx = max(range(len(train_ds)), key=lambda i: train_ds[i]["input_ids"].numel())
    pre_batch = to_device(collate([train_ds[longest_idx]]))
    print("\nRunning one-batch backward/OOM preflight on longest encoded row...")
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

    initial_val = eval_loss(model, val_loader)
    print(f"Initial validation loss: {initial_val:.4f}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    history = []
    optimizer_steps = 0
    start = time.time()

    for epoch in range(1, EPOCHS + 1):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        running = 0.0
        seen = 0

        for i, batch in enumerate(train_loader, start=1):
            batch = to_device(batch)
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                out = model(**batch)
                loss = out.loss
                if not torch.isfinite(loss):
                    raise RuntimeError(f"Non-finite loss at epoch={epoch} row={i}: {loss}")
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

            if i % 40 == 0 or i == len(train_loader):
                print(
                    f"epoch {epoch}/{EPOCHS} | {i}/{len(train_loader)} | "
                    f"train_loss={running/seen:.4f} | opt_steps={optimizer_steps} | "
                    f"vram_alloc={torch.cuda.memory_allocated(0)/1024**3:.2f}GB"
                )

            del batch, out, loss, scaled

        train_avg = running / max(1, seen)
        val_avg = eval_loss(model, val_loader)
        elapsed = time.time() - start
        history.append({
            "epoch": epoch,
            "train_loss": train_avg,
            "validation_loss": val_avg,
            "optimizer_steps": optimizer_steps,
            "elapsed_seconds": round(elapsed, 1),
        })
        print(
            f"EPOCH {epoch} COMPLETE | train_loss={train_avg:.4f} | "
            f"validation_loss={val_avg:.4f} | elapsed={elapsed/60:.1f} min"
        )
        model.save_pretrained(OUT_DIR / f"epoch-{epoch}")

    model.save_pretrained(OUT_DIR)
    tokenizer.save_pretrained(OUT_DIR)

    summary = {
        "run": "buyflow-v17-gemma3-12b-qlora-r8-v3",
        "base_model": "google/gemma-3-12b-it",
        "train_rows": len(train_rows),
        "validation_rows": len(val_rows),
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "external_blind_v2_touched": False,
        "assistant_masking": "rendered_text_boundary",
        "quantization": "bnb-4bit-nf4-double-quant-bf16",
        "lora": {
            "r": 8,
            "alpha": 16,
            "dropout": 0.05,
            "text_target_module_count": len(target_modules),
        },
        "max_length": MAX_LENGTH,
        "epochs": EPOCHS,
        "grad_accum": GRAD_ACCUM,
        "learning_rate": LR,
        "initial_validation_loss": initial_val,
        "history": history,
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
    print("BUYFLOW V17 QLORA TRAINING V3: COMPLETE")
    print(f"Adapter: {OUT_DIR}")
    print(f"Initial val loss: {initial_val:.4f}")
    print(f"Final val loss:   {history[-1]['validation_loss']:.4f}")
    print(f"Optimizer steps:  {optimizer_steps}")
    print("External Blind V2: UNTOUCHED")
    print("Production: OFF")
    print("==============================================================")


if __name__ == "__main__":
    main()
