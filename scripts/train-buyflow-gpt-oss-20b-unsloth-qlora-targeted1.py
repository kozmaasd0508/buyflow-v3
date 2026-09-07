import hashlib
import json
import os
import random
from pathlib import Path

os.environ.setdefault("UNSLOTH_ROCM_GFX_ARCH", "gfx1200")

import torch
from datasets import Dataset
from unsloth import FastLanguageModel
from unsloth.chat_templates import train_on_responses_only
from trl import SFTConfig, SFTTrainer

SEED = 17520
random.seed(SEED)
torch.manual_seed(SEED)

HOME = Path.home()
DATA_DIR = HOME / "Desktop" / "buyflow-v17-5-targeted"
TRAIN_FILE = DATA_DIR / "train.jsonl"
VAL_FILE = DATA_DIR / "validation.jsonl"
OUT_DIR = HOME / "BuyFlowTools" / "adapters" / "buyflow-gpt-oss-20b-qlora-targeted1"
RUN_DIR = HOME / "BuyFlowTools" / "gptoss-training" / "targeted1-run"

EXPECTED_TRAIN_SHA = "2d5f11244bec1292827460b05fec215f404b12799b0375fbce8ea52d3883d092"
EXPECTED_VAL_SHA = "15f68db07fb844b09708f25599ade58cf510bc24dea4ec9a99eb64472899e93c"
EXPECTED_TRAIN_ROWS = 2400
EXPECTED_VAL_ROWS = 320
FIELDS = ["event_type", "perspective", "order_id", "tracking_id", "link_status"]
EVENTS = [
    "ORDER_CREATED", "ORDER_PROCESSING", "PAYMENT", "INVOICE", "SHIPMENT_CREATED",
    "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED",
    "CANCELLED", "REFUNDED", "RETURN", "OTHER",
]

DEVELOPER = """You are BuyFlow's commerce-email semantic classifier.
Classify the CURRENT meaning of the email, not quoted/older history. Never invent facts or IDs.
Return exactly one JSON object with these fields: event_type, perspective, order_id, tracking_id, link_status.

Allowed event_type values only:
ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.

Allowed perspective values only: buyer, merchant_outbound, non_purchase.
- buyer: mailbox owner is the customer/buyer side, even if sender is merchant/warehouse/carrier/payment/invoice provider.
- merchant_outbound: mailbox owner is explicitly the seller sending parcels to their own customers.
- non_purchase: marketing, security, surveys, preferences, or other non-purchase content.

Allowed link_status values only: linked, unresolved, not_applicable.
- linked: exact order ID is present, or there is explicit verified order-to-tracking context.
- unresolved: real purchase lifecycle event but no exact purchase link is available, or candidates are ambiguous.
- not_applicable: no purchase lifecycle linking is required.

Lifecycle boundaries:
- SHIPMENT_CREATED = label/pre-advice/tracking created, but no physical carrier pickup.
- SHIPPED = carrier physically collected parcel from sender; no later network movement is current.
- IN_TRANSIT = parcel is moving/processed inside carrier network.
- OUT_FOR_DELIVERY = parcel assigned to today's courier/vehicle route.
- READY_FOR_PICKUP = parcel physically at locker/pickup point and available.
- DELIVERED = recipient handoff completed.
- REFUNDED = money actually returned/completed.
- RETURN = returned parcel physically received by merchant/returns warehouse.
- refund request or return-label creation alone is not settled REFUNDED/RETURN.
Do not treat promo/documentation/example strings as real order/tracking IDs."""


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


def get_role(messages, role):
    for m in messages:
        if m.get("role") == role:
            return str(m.get("content", ""))
    return ""


def extract_email(user_text: str) -> str:
    # V17 teacher rows prepend an instruction before the actual email.
    marker = "\n\n"
    if user_text.lower().startswith("elemezd ezt az e-mailt buyflow szerint") and marker in user_text:
        return user_text.split(marker, 1)[1].strip()
    return user_text.strip()


def make_conversation(row):
    messages = row.get("messages") or []
    user_text = get_role(messages, "user")
    assistant_text = get_role(messages, "assistant")
    if not user_text or not assistant_text:
        raise RuntimeError(f"Missing user/assistant in row {row.get('id')}")
    target = json.loads(assistant_text)
    clean = {f: target.get(f) for f in FIELDS}
    if clean["event_type"] not in EVENTS:
        raise RuntimeError(f"Invalid event target in row {row.get('id')}: {clean['event_type']}")
    final_json = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
    return [
        {"role": "system", "content": DEVELOPER},
        {"role": "user", "content": extract_email(user_text)},
        {"role": "assistant", "content": final_json},
    ]


def main():
    print("=" * 62)
    print("BUYFLOW GPT-OSS 20B TARGETED QLORA - UNSLOTH / AMD")
    print("Base: unsloth/gpt-oss-20b | QLoRA 4-bit | Harmony template")
    print("Data: independent V17.5 targeted corpus, NOT Blind O2")
    print("LoRA: r=8 alpha=16 all attention+MLP linear modules")
    print("1 epoch | batch=1 | grad_accum=8 | lr=1e-4 | max_seq=1024")
    print("Production: OFF")
    print("=" * 62)

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU is not visible to PyTorch")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB")
    print(f"torch={torch.__version__} hip={getattr(torch.version, 'hip', None)}")

    for p in (TRAIN_FILE, VAL_FILE):
        if not p.exists():
            raise RuntimeError(f"Required dataset missing: {p}")

    train_sha = sha256_file(TRAIN_FILE)
    val_sha = sha256_file(VAL_FILE)
    print(f"train sha256:      {train_sha}")
    print(f"validation sha256: {val_sha}")
    if train_sha != EXPECTED_TRAIN_SHA or val_sha != EXPECTED_VAL_SHA:
        raise RuntimeError("Dataset hash mismatch; refusing to train")

    train_rows = read_jsonl(TRAIN_FILE)
    val_rows = read_jsonl(VAL_FILE)
    if len(train_rows) != EXPECTED_TRAIN_ROWS or len(val_rows) != EXPECTED_VAL_ROWS:
        raise RuntimeError(f"Unexpected row counts: train={len(train_rows)} val={len(val_rows)}")

    train_convs = [make_conversation(x) for x in train_rows]
    val_convs = [make_conversation(x) for x in val_rows]
    print(f"DATA CONTRACT: PASS | train={len(train_convs)} validation={len(val_convs)}")

    max_seq_length = 1024
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name="unsloth/gpt-oss-20b",
        dtype=None,
        max_seq_length=max_seq_length,
        load_in_4bit=True,
        full_finetuning=False,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=8,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=SEED,
    )

    def render(batch):
        out = []
        for messages in batch["messages"]:
            text = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=False,
                reasoning_effort="low",
            )
            out.append(text)
        return {"text": out}

    train_ds = Dataset.from_list([{"messages": x} for x in train_convs]).map(render, batched=True)
    val_ds = Dataset.from_list([{"messages": x} for x in val_convs]).map(render, batched=True)

    # Refuse to proceed if the required Harmony final-response boundary disappeared.
    marker = "<|start|>assistant<|channel|>final<|message|>"
    if marker not in train_ds[0]["text"]:
        raise RuntimeError("Harmony final-response marker missing; refusing to guess loss boundary")
    print("HARMONY TEMPLATE PRECHECK: PASS")

    RUN_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)

    args = SFTConfig(
        output_dir=str(RUN_DIR),
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=8,
        num_train_epochs=1,
        learning_rate=1e-4,
        warmup_ratio=0.05,
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        optim="adamw_8bit",
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        report_to="none",
        seed=SEED,
        bf16=True,
        fp16=False,
        max_length=max_seq_length,
        packing=False,
        dataset_text_field="text",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        args=args,
    )

    trainer = train_on_responses_only(
        trainer,
        instruction_part="<|start|>user<|message|>",
        response_part=marker,
    )

    # Small forward/backward preflight before the long run.
    print("Running Unsloth trainer preflight/eval...")
    initial_eval = trainer.evaluate()
    print("Initial eval:", json.dumps(initial_eval, ensure_ascii=False, default=str))

    print("Starting REAL GPT-OSS targeted QLoRA training...")
    result = trainer.train()
    print("Train result:", result)

    final_eval = trainer.evaluate()
    print("Final eval:", json.dumps(final_eval, ensure_ascii=False, default=str))

    model.save_pretrained(str(OUT_DIR))
    tokenizer.save_pretrained(str(OUT_DIR))

    summary = {
        "run": "buyflow-gpt-oss-20b-qlora-targeted1",
        "base_model": "unsloth/gpt-oss-20b",
        "output_adapter": str(OUT_DIR),
        "train_rows": len(train_rows),
        "validation_rows": len(val_rows),
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "blind_o2_used_for_training": False,
        "epochs": 1,
        "lora_r": 8,
        "lora_alpha": 16,
        "learning_rate": 1e-4,
        "grad_accum": 8,
        "max_seq_length": max_seq_length,
        "initial_eval": initial_eval,
        "final_eval": final_eval,
        "gpu": torch.cuda.get_device_name(0),
        "production": "OFF",
    }
    (OUT_DIR / "training-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )

    print("=" * 62)
    print("BUYFLOW GPT-OSS 20B TARGETED QLORA: COMPLETE")
    print(f"Adapter: {OUT_DIR}")
    print("Blind O2: NOT USED FOR TRAINING")
    print("Next proof: fresh Blind O3, base GPT-OSS vs tuned GPT-OSS")
    print("Production: OFF")
    print("=" * 62)


if __name__ == "__main__":
    main()
