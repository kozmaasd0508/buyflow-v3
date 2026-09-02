#!/usr/bin/env python3
from __future__ import annotations

import gc
import hashlib
import json
import math
import os
import random
import shutil
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from peft import PeftModel, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

MODEL_ID = os.environ.get("BUYFLOW_LORA_MODEL_ID", "Qwen/Qwen3-8B")
MAX_SEQ = int(os.environ.get("BUYFLOW_V12_MAX_SEQ", "768"))
EPOCHS = int(os.environ.get("BUYFLOW_V12_EPOCHS", "1"))
GRAD_ACCUM = int(os.environ.get("BUYFLOW_V12_GRAD_ACCUM", "4"))
LR = float(os.environ.get("BUYFLOW_V12_LR", "0.00002"))
MAX_GRAD_NORM = 1.0
SEED = 42
EXPECTED_TRAIN_ROWS = 1296
EXPECTED_VALIDATION_ROWS = 360
EXPECTED_TRAIN_SHA = "81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a"
EXPECTED_VALIDATION_SHA = "d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6"
EXPECTED_PARENT_ADAPTER_SHA = "462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b"
PARENT_RUN_NAME = "20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic"
ALLOWED = {
    "ORDER_CREATED", "ORDER_PROCESSING", "ORDER_PACKING", "SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT",
    "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED", "DELIVERY_FAILED", "DELAYED", "CANCELLED",
    "REFUNDED", "PAYMENT", "INVOICE", "RETURN", "WARRANTY", "OTHER",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jsonl(path: Path, expected: int, name: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not {"instruction", "input", "output", "metadata"} <= set(row):
                raise RuntimeError(f"{name} row {line_number} missing fields")
            target = json.loads(row["output"])
            if set(target) != {"is_commerce", "event_type"}:
                raise RuntimeError(f"{name} row {line_number} target schema")
            if target["event_type"] not in ALLOWED or not isinstance(target["is_commerce"], bool):
                raise RuntimeError(f"{name} row {line_number} invalid target")
            if target["is_commerce"] != (target["event_type"] != "OTHER"):
                raise RuntimeError(f"{name} row {line_number} commerce/event mismatch")
            rows.append(row)
    if len(rows) != expected:
        raise RuntimeError(f"{name}: expected {expected}, got {len(rows)}")
    return rows


def canonical_hash(row: dict[str, Any]) -> str:
    raw = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def templ(tokenizer: Any, messages: list[dict[str, str]], generation: bool) -> str:
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=generation,
            enable_thinking=False,
        )
    except TypeError:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=generation)


def encode_row(tokenizer: Any, row: dict[str, Any], split: str, index: int) -> dict[str, Any]:
    user = f"{row['instruction']}\n\nEMAIL_DOCUMENT:\n{row['input']}"
    prompt_messages = [{"role": "user", "content": user}]
    full_messages = prompt_messages + [{"role": "assistant", "content": row["output"]}]
    prompt_ids = tokenizer(templ(tokenizer, prompt_messages, True), add_special_tokens=False)["input_ids"]
    full_ids = tokenizer(templ(tokenizer, full_messages, False), add_special_tokens=False)["input_ids"]
    prefix = 0
    while prefix < min(len(prompt_ids), len(full_ids)) and prompt_ids[prefix] == full_ids[prefix]:
        prefix += 1
    if prefix == 0 or prefix >= len(full_ids):
        raise RuntimeError(f"{split} row {index}: target isolation failed")
    if len(full_ids) > MAX_SEQ:
        raise RuntimeError(f"{split} row {index}: tokens {len(full_ids)} > MAX_SEQ {MAX_SEQ}")
    labels = [-100] * prefix + full_ids[prefix:]
    event_type = json.loads(row["output"])["event_type"]
    source = str(row.get("metadata", {}).get("v12_source", "UNKNOWN"))
    return {
        "input_ids": torch.tensor([full_ids]),
        "attention_mask": torch.ones((1, len(full_ids)), dtype=torch.long),
        "labels": torch.tensor([labels]),
        "event_type": event_type,
        "source": source,
        "token_count": len(full_ids),
    }


def encode_split(tokenizer: Any, rows: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    encoded = [encode_row(tokenizer, row, name, i) for i, row in enumerate(rows, 1)]
    lengths = sorted(item["token_count"] for item in encoded)

    def percentile(p: float) -> int:
        return lengths[max(0, math.ceil(len(lengths) * p) - 1)]

    print(
        f"{name.lower()}_token_stats: min={lengths[0]} p50={percentile(.5)} "
        f"p95={percentile(.95)} max={lengths[-1]}"
    )
    return encoded


def batch(sample: dict[str, Any]) -> dict[str, torch.Tensor]:
    return {key: sample[key].to("cuda") for key in ("input_ids", "attention_mask", "labels")}


@torch.no_grad()
def evaluate(model: Any, samples: list[dict[str, Any]]) -> tuple[float, dict[str, float], dict[str, float]]:
    model.eval()
    losses: list[float] = []
    event_sums: Counter[str] = Counter()
    event_counts: Counter[str] = Counter()
    source_sums: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    for sample in samples:
        loss = model(**batch(sample)).loss
        if loss is None or not torch.isfinite(loss):
            raise RuntimeError("non-finite validation loss")
        value = float(loss.detach().cpu())
        losses.append(value)
        event_sums[sample["event_type"]] += value
        event_counts[sample["event_type"]] += 1
        source_sums[sample["source"]] += value
        source_counts[sample["source"]] += 1
    model.train()
    by_event = {key: event_sums[key] / event_counts[key] for key in sorted(event_counts)}
    by_source = {key: source_sums[key] / source_counts[key] for key in sorted(source_counts)}
    return sum(losses) / len(losses), by_event, by_source


def save_adapter(model: Any, tokenizer: Any, path: Path) -> int:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)
    model.save_pretrained(path, safe_serialization=True)
    tokenizer.save_pretrained(path)
    weight = path / "adapter_model.safetensors"
    if not weight.is_file():
        raise RuntimeError("adapter weights missing")
    return weight.stat().st_size


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: train-v12-retention-qwen-v1.py <project-root>")
    root = Path(sys.argv[1]).resolve()

    data = root / "local-data" / "lora-v12" / "retention-replay-v1"
    manifest_path = data / "manifest.json"
    train_path = data / "train.merged.sft.jsonl"
    validation_path = data / "validation.merged.sft.jsonl"
    if not manifest_path.is_file():
        raise RuntimeError(f"V12_REPLAY_MANIFEST_MISSING:{manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") != "V12_RETENTION_REPLAY_V1_READY":
        raise RuntimeError(f"V12_REPLAY_STATUS:{manifest.get('status')}")
    if manifest.get("training_started") is not False:
        raise RuntimeError("V12_REPLAY_TRAINING_FLAG_UNEXPECTED")
    for key in (
        "frozen_holdouts_read", "fresh_blind_read", "input_view_holdout_read", "frozen108_read", "blind50_read"
    ):
        if manifest.get(key) is not False:
            raise RuntimeError(f"V12_REPLAY_SAFETY_GATE:{key}")

    actual_train_sha = sha256_file(train_path)
    actual_validation_sha = sha256_file(validation_path)
    if actual_train_sha != EXPECTED_TRAIN_SHA:
        raise RuntimeError(f"V12_TRAIN_SHA_MISMATCH:{actual_train_sha}")
    if actual_validation_sha != EXPECTED_VALIDATION_SHA:
        raise RuntimeError(f"V12_VALIDATION_SHA_MISMATCH:{actual_validation_sha}")

    train = load_jsonl(train_path, EXPECTED_TRAIN_ROWS, "TRAIN")
    validation = load_jsonl(validation_path, EXPECTED_VALIDATION_ROWS, "VALIDATION")
    overlap = {canonical_hash(row) for row in train} & {canonical_hash(row) for row in validation}
    if overlap:
        raise RuntimeError(f"V12_TRAIN_VALIDATION_OVERLAP:{len(overlap)}")

    train_dist = Counter(json.loads(row["output"])["event_type"] for row in train)
    validation_dist = Counter(json.loads(row["output"])["event_type"] for row in validation)
    if set(train_dist) != ALLOWED or set(validation_dist) != ALLOWED:
        raise RuntimeError("V12_ALL_18_EVENTS_NOT_PRESENT")
    if train_dist["ORDER_PROCESSING"] != 136 or train_dist["ORDER_PACKING"] != 136:
        raise RuntimeError(f"V12_HARD_TRAIN_DISTRIBUTION:{dict(train_dist)}")
    if validation_dist["ORDER_PROCESSING"] != 52 or validation_dist["ORDER_PACKING"] != 52:
        raise RuntimeError(f"V12_HARD_VALIDATION_DISTRIBUTION:{dict(validation_dist)}")
    for event in ALLOWED - {"ORDER_PROCESSING", "ORDER_PACKING"}:
        if train_dist[event] != 64 or validation_dist[event] != 16:
            raise RuntimeError(f"V12_RETENTION_DISTRIBUTION:{event}:{train_dist[event]}/{validation_dist[event]}")

    parent_run = root / "local-data" / "lora-v11" / "runs" / PARENT_RUN_NAME
    parent_adapter = parent_run / "best"
    parent_metrics_path = parent_run / "metrics.json"
    parent_weights = parent_adapter / "adapter_model.safetensors"
    if not parent_metrics_path.is_file() or not parent_weights.is_file():
        raise RuntimeError(f"V11_PARENT_ADAPTER_MISSING:{parent_adapter}")
    parent_metrics = json.loads(parent_metrics_path.read_text(encoding="utf-8"))
    if parent_metrics.get("status") != "LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE":
        raise RuntimeError(f"V11_PARENT_STATUS:{parent_metrics.get('status')}")
    for key in ("frozen_108_trained", "blind_50_trained", "locked_test_read", "locked_test_trained"):
        if parent_metrics.get(key) is not False:
            raise RuntimeError(f"V11_PARENT_SAFETY_GATE:{key}")
    parent_sha = sha256_file(parent_weights)
    if parent_sha != EXPECTED_PARENT_ADAPTER_SHA:
        raise RuntimeError(f"V11_PARENT_ADAPTER_SHA_MISMATCH:{parent_sha}")

    print("# BUYFLOW V12 QWEN3-8B RETENTION ROBUSTNESS QLORA")
    print(f"parent_adapter_sha256: {parent_sha}")
    print(f"train_sha256: {actual_train_sha}")
    print(f"validation_sha256: {actual_validation_sha}")
    print(f"train_records: {len(train)}")
    print(f"validation_records: {len(validation)}")
    print("events: 18 retained")
    print("hard_boundary: ORDER_PROCESSING vs ORDER_PACKING")
    print("frozen_holdouts_read: False")
    print("fresh_blind_read: False")
    print("input_view_holdout_read: False")
    print("frozen108_read: False")
    print("blind50_read: False")
    print()

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU unavailable")
    print(f"gpu_name: {torch.cuda.get_device_name(0)}")
    print(f"torch: {torch.__version__}")
    print(f"torch_hip: {torch.version.hip}")
    print(f"model_id: {MODEL_ID}")

    random.seed(SEED)
    torch.manual_seed(SEED)
    torch.cuda.manual_seed_all(SEED)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    print("[1/6] Encoding merged retention corpus...")
    encoded_train = encode_split(tokenizer, train, "TRAIN")
    encoded_validation = encode_split(tokenizer, validation, "VALIDATION")

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.float16,
    )
    print("[2/6] Loading Qwen3-8B NF4...")
    base = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=quantization,
        device_map={"": 0},
        dtype=torch.float16,
        low_cpu_mem_usage=True,
        local_files_only=True,
    )
    base.config.use_cache = False

    print("[3/6] Loading V11 best adapter as trainable parent...")
    base = prepare_model_for_kbit_training(
        base,
        use_gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
    )
    model = PeftModel.from_pretrained(base, parent_adapter, is_trainable=True)
    params = [parameter for parameter in model.parameters() if parameter.requires_grad]
    trainable, total = model.get_nb_trainable_parameters()
    if trainable <= 0:
        raise RuntimeError("V12_NO_TRAINABLE_ADAPTER_PARAMS")
    print(f"trainable_params: {trainable}")
    print(f"total_params_reported: {total}")
    print(f"trainable_percent: {100 * trainable / total:.4f}")

    optimizer = torch.optim.AdamW(params, lr=LR, betas=(.9, .999), weight_decay=0.0)
    steps_per_epoch = math.ceil(len(encoded_train) / GRAD_ACCUM)
    total_steps = steps_per_epoch * EPOCHS
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run = root / "local-data" / "lora-v12" / "runs" / f"{stamp}-qwen3-8b-buyflow-v12-retention-robustness"
    best = run / "best"
    last = run / "last"
    run.mkdir(parents=True, exist_ok=False)
    config = {
        "status": "V12_RETENTION_TRAIN_CONFIG_READY",
        "model_id": MODEL_ID,
        "parent_run": str(parent_run),
        "parent_adapter": str(parent_adapter),
        "parent_adapter_sha256": parent_sha,
        "train_file": str(train_path),
        "validation_file": str(validation_path),
        "train_sha256": actual_train_sha,
        "validation_sha256": actual_validation_sha,
        "train_records": len(encoded_train),
        "validation_records": len(encoded_validation),
        "epochs": EPOCHS,
        "gradient_accumulation": GRAD_ACCUM,
        "learning_rate": LR,
        "max_seq": MAX_SEQ,
        "seed": SEED,
        "quantization": "NF4 double-quant fp16",
        "continuation_from_v11": True,
        "constrained_decoder_weights_changed": False,
        "frozen_holdouts_read": False,
        "fresh_blind_read": False,
        "input_view_holdout_read": False,
        "frozen108_read": False,
        "blind50_read": False,
    }
    (run / "training_config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    print(f"[4/6] V12 continuation QLoRA: {len(encoded_train)} TRAIN / {len(encoded_validation)} VALIDATION")
    print(
        f"hyperparams: epochs={EPOCHS} grad_accum={GRAD_ACCUM} optimizer_steps={total_steps} "
        f"lr={LR:g} max_seq={MAX_SEQ}"
    )
    print(f"run_dir: {run}")

    best_validation_loss = math.inf
    best_epoch: int | None = None
    history: list[dict[str, Any]] = []
    global_step = 0
    started = time.time()
    model.train()
    for epoch in range(1, EPOCHS + 1):
        order = list(range(len(encoded_train)))
        random.Random(SEED + epoch).shuffle(order)
        optimizer.zero_grad(set_to_none=True)
        epoch_loss = 0.0
        accumulated_loss = 0.0
        accumulated_count = 0
        for position, sample_index in enumerate(order, 1):
            loss = model(**batch(encoded_train[sample_index])).loss
            if loss is None or not torch.isfinite(loss):
                raise RuntimeError(f"non-finite loss epoch={epoch} pos={position}")
            raw_loss = float(loss.detach().cpu())
            epoch_loss += raw_loss
            accumulated_loss += raw_loss
            accumulated_count += 1
            (loss / GRAD_ACCUM).backward()
            if accumulated_count < GRAD_ACCUM and position != len(order):
                continue
            norm = torch.nn.utils.clip_grad_norm_(params, MAX_GRAD_NORM)
            if not torch.isfinite(norm):
                raise RuntimeError("non-finite grad norm")
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            global_step += 1
            if global_step % 25 == 0 or position == len(order):
                torch.cuda.synchronize()
                print(
                    f"train_progress: epoch={epoch}/{EPOCHS} step={global_step}/{total_steps} "
                    f"examples={position}/{len(order)} loss={accumulated_loss/accumulated_count:.6f} "
                    f"gpu_gib={torch.cuda.memory_allocated()/(1024**3):.2f}"
                )
            accumulated_loss = 0.0
            accumulated_count = 0

        mean_train_loss = epoch_loss / len(order)
        print(f"validation_start: epoch={epoch}")
        validation_loss, by_event, by_source = evaluate(model, encoded_validation)
        print(
            f"epoch_summary: epoch={epoch} train_loss={mean_train_loss:.6f} "
            f"validation_loss={validation_loss:.6f}"
        )
        print("validation_event_loss: " + ",".join(f"{key}={value:.6f}" for key, value in by_event.items()))
        print("validation_source_loss: " + ",".join(f"{key}={value:.6f}" for key, value in by_source.items()))
        improved = validation_loss < best_validation_loss
        if improved:
            best_validation_loss = validation_loss
            best_epoch = epoch
            size = save_adapter(model, tokenizer, best)
            print(
                f"best_adapter_saved: epoch={epoch} validation_loss={validation_loss:.6f} "
                f"adapter_size_mib={size/(1024**2):.2f}"
            )
        history.append(
            {
                "epoch": epoch,
                "train_loss": mean_train_loss,
                "validation_loss": validation_loss,
                "validation_event_loss": by_event,
                "validation_source_loss": by_source,
                "best_so_far": improved,
            }
        )

    print("[5/6] Saving V12 child adapter + metrics...")
    last_size = save_adapter(model, tokenizer, last)
    elapsed = time.time() - started
    peak = torch.cuda.max_memory_allocated() / (1024**3)
    best_sha = sha256_file(best / "adapter_model.safetensors") if (best / "adapter_model.safetensors").is_file() else None
    metrics = {
        "status": "LORA_V12_RETENTION_ROBUSTNESS_TRAIN_COMPLETE",
        "run_dir": str(run),
        "best_adapter_dir": str(best),
        "last_adapter_dir": str(last),
        "best_adapter_sha256": best_sha,
        "parent_adapter_sha256": parent_sha,
        "train_sha256": actual_train_sha,
        "validation_sha256": actual_validation_sha,
        "best_epoch": best_epoch,
        "best_validation_loss": best_validation_loss,
        "history": history,
        "training_seconds": elapsed,
        "gpu_peak_allocated_gib": peak,
        "last_adapter_size_mib": last_size / (1024**2),
        "continuation_from_v11": True,
        "all_18_events_retained": True,
        "hard_sibling_training_rows": 144,
        "v11_replay_training_rows": 1152,
        "hard_sibling_validation_rows": 72,
        "v11_replay_validation_rows": 288,
        "raw_customer_data_trained": False,
        "frozen_holdouts_read": False,
        "fresh_blind_read": False,
        "input_view_holdout_read": False,
        "frozen108_trained": False,
        "blind50_trained": False,
        "locked_test_read": False,
        "locked_test_trained": False,
    }
    (run / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    latest = root / "local-data" / "lora-v12" / "LATEST.txt"
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(str(run) + "\n", encoding="utf-8")

    print("[6/6] Final verification...")
    if best_epoch is None or not (best / "adapter_model.safetensors").is_file():
        raise RuntimeError("best V12 adapter missing")
    if global_step != total_steps:
        raise RuntimeError(f"optimizer step mismatch {global_step}!={total_steps}")
    if sha256_file(parent_weights) != EXPECTED_PARENT_ADAPTER_SHA:
        raise RuntimeError("V11_PARENT_CHANGED_DURING_TRAINING")
    print(f"optimizer_steps_completed: {global_step}")
    print(f"best_epoch: {best_epoch}")
    print(f"best_validation_loss: {best_validation_loss:.6f}")
    print(f"training_minutes: {elapsed/60:.2f}")
    print(f"gpu_peak_allocated_gib: {peak:.2f}")
    print(f"best_adapter_sha256: {best_sha}")
    print(f"best_adapter_dir: {best}")
    print(f"metrics_file: {run/'metrics.json'}")
    print("parent_v11_unchanged: True")
    print("frozen_holdouts_read: False")
    print("frozen108_trained: False")
    print("blind50_trained: False")
    print("adapter_saved: True")
    print("status: V12_TRAINING_COMPLETE")

    del model
    gc.collect()
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
