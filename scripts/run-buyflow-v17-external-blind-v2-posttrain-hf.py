import hashlib
import json
import os
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
ADAPTER_DIR = ROOT / "adapters" / "buyflow-v17-gemma3-12b-qlora-r8-v3"
BLIND_DIR = Path.home() / "Desktop" / "buyflow-v17-external-blind-v2"
INPUT_FILE = BLIND_DIR / "blind-input.jsonl"
GOLD_FILE = BLIND_DIR / "blind-gold.jsonl"
MANIFEST_FILE = BLIND_DIR / "manifest.json"
BASELINE_SUMMARY = BLIND_DIR / "baseline-v17.1-contract-summary.json"
OUT_SUMMARY = BLIND_DIR / "posttrain-v17-qlora-r8-v3-summary.json"

EXPECTED_INPUT_SHA = "926c72bb723201ee186e8bf6ce530713d7e4b9b833182f952e9875a077e014b0"
EXPECTED_GOLD_SHA = "e936113fcc926a23ea27dd82f7b1ace16b2cd815449339fcab61edb32627f04e"

SYSTEM = """You are a helpful assistant analyzing commerce emails for BuyFlow.
Understand each email from its actual meaning and evidence. Do not invent missing facts or links.
Use only these event_type values: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
If the text clearly says the seller handed the parcel to the carrier, classify it as SHIPPED rather than SHIPMENT_CREATED.
Use only these perspective values:
- buyer = an incoming message about the mailbox owner's own purchase, payment, invoice, shipment, delivery, cancellation, refund or return;
- merchant_outbound = the mailbox owner is acting as the seller/sender and a carrier is collecting or transporting parcels the mailbox owner sends to customers;
- non_purchase = the message itself is not a purchase lifecycle event, such as marketing, account/security or survey mail.
Use only these link_status values:
- linked = exact evidence or supplied BuyFlow context ties the email to a purchase;
- unresolved = a real commerce/lifecycle event exists but cannot be tied to a purchase with reliable evidence;
- not_applicable = no purchase linking is applicable, such as marketing/security or merchant-outbound operational mail.
If supplied BuyFlow context explicitly maps an order to a tracking ID, preserve that exact order_id and tracking_id and use linked.
Answer only with the requested JSON object."""

FIELDS = ["event_type", "perspective", "order_id", "tracking_id", "link_status"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_jsonl(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def norm(v):
    if not isinstance(v, dict):
        return None
    return {k: v.get(k) for k in FIELDS}


def extract_json(text: str):
    t = str(text or "").strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    if "```" in t:
        parts = t.split("```")
        for part in parts:
            p = part.strip()
            if p.lower().startswith("json"):
                p = p[4:].strip()
            try:
                return json.loads(p)
            except Exception:
                pass
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        return json.loads(t[a : b + 1])
    raise ValueError("invalid_json")


def pct(n: int) -> float:
    return round(n / 30 * 100, 2)


def main():
    print("==============================================================")
    print("BUYFLOW V17 EXTERNAL BLIND V2 - POSTTRAIN QLORA")
    print("Base: google/gemma-3-12b-it")
    print(f"Adapter: {ADAPTER_DIR}")
    print("Cases: 30 | FROZEN | aggregate-only")
    print("Per-case gold/failures: HIDDEN")
    print("Gmail 0 | BuyFlow writes 0 | Production OFF")
    print("==============================================================")

    for p in (MODEL_DIR, ADAPTER_DIR, INPUT_FILE, GOLD_FILE, MANIFEST_FILE):
        if not p.exists():
            raise RuntimeError(f"Missing required path: {p}")

    input_sha = sha256_file(INPUT_FILE)
    gold_sha = sha256_file(GOLD_FILE)
    print(f"input sha256: {input_sha}")
    print(f"gold sha256:  {gold_sha}")
    if input_sha != EXPECTED_INPUT_SHA:
        raise RuntimeError("External Blind V2 input hash mismatch; refusing to run")
    if gold_sha != EXPECTED_GOLD_SHA:
        raise RuntimeError("External Blind V2 gold hash mismatch; refusing to run")

    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    if manifest.get("dataset") != "buyflow-v17-external-blind-v2" or manifest.get("count") != 30:
        raise RuntimeError("Unexpected external blind manifest")

    inputs = read_jsonl(INPUT_FILE)
    if len(inputs) != 30:
        raise RuntimeError(f"Expected 30 blind inputs, got {len(inputs)}")

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU is not visible to PyTorch")

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    qconfig = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    print("\nLoading cached 4-bit base + trained LoRA adapter...")
    base = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
        local_files_only=True,
    ).eval()
    model = PeftModel.from_pretrained(base, str(ADAPTER_DIR), is_trainable=False).eval()
    print(
        f"LOAD: PASS | gpu={torch.cuda.get_device_name(0)} | "
        f"allocated={torch.cuda.memory_allocated(0)/1024**3:.2f} GB | "
        f"reserved={torch.cuda.memory_reserved(0)/1024**3:.2f} GB"
    )

    preds = []
    errors = 0
    for i, row in enumerate(inputs, start=1):
        user = (
            "Elemezd ezt az e-mailt BuyFlow szerint. Csak egy JSON objektumot adj vissza pontosan "
            "ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status. "
            "Ha order_id vagy tracking_id nem bizonyítható, legyen null.\n\n"
            + str(row["input"])
        )
        # Gemma text-only training merged system instructions into the user turn, so do the same here.
        merged = SYSTEM + "\n\n" + user
        prompt = tokenizer.apply_chat_template(
            [{"role": "user", "content": merged}],
            tokenize=False,
            add_generation_prompt=True,
        )
        enc = tokenizer(prompt, return_tensors="pt")
        enc = {k: v.to("cuda") for k, v in enc.items()}
        input_len = enc["input_ids"].shape[-1]
        print(f"[{i:02d}/30] inference ... ", end="", flush=True)
        try:
            with torch.inference_mode():
                out = model.generate(
                    **enc,
                    max_new_tokens=192,
                    do_sample=False,
                    use_cache=True,
                )
            text = tokenizer.decode(out[0][input_len:], skip_special_tokens=True).strip()
            preds.append({"id": row["id"], "pred": norm(extract_json(text))})
            print("OK")
        except Exception as e:
            errors += 1
            preds.append({"id": row["id"], "pred": None})
            print(f"ERROR {type(e).__name__}")
        finally:
            del enc
            if "out" in locals():
                del out

    # Gold is parsed only after all 30 inferences are complete. Never print case-level gold/failures.
    gold_rows = read_jsonl(GOLD_FILE)
    gold = {x["id"]: norm(x["gold"]) for x in gold_rows}
    fc = {f: 0 for f in FIELDS}
    exact = 0
    for r in preds:
        g = gold.get(r["id"])
        p = r["pred"]
        if g is None or p is None:
            continue
        all_ok = True
        for f in FIELDS:
            if p[f] == g[f]:
                fc[f] += 1
            else:
                all_ok = False
        if all_ok:
            exact += 1

    summary = {
        "benchmark": "buyflow-v17-external-blind-v2",
        "runtime": "posttrain-hf-qlora-r8-v3",
        "base_model": "google/gemma-3-12b-it",
        "adapter": str(ADAPTER_DIR),
        "cases": 30,
        "exact": {"correct": exact, "pct": pct(exact)},
        "fields": {f: {"correct": fc[f], "pct": pct(fc[f])} for f in FIELDS},
        "errors": errors,
        "input_sha256": input_sha,
        "gold_sha256": gold_sha,
        "per_case_details_printed": False,
        "production": "OFF",
    }
    OUT_SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n==================== POSTTRAIN RESULT ========================")
    print(f"EXACT: {exact}/30 = {pct(exact)}%")
    for f in FIELDS:
        print(f"{f}: {fc[f]}/30 = {pct(fc[f])}%")
    print(f"Errors: {errors}")
    print("Gold/failure details: HIDDEN")

    if BASELINE_SUMMARY.exists():
        try:
            baseline = json.loads(BASELINE_SUMMARY.read_text(encoding="utf-8"))
            b_exact = float(baseline["exact"]["pct"])
            print("\n==================== DELTA VS PRETRAIN =======================")
            print(f"EXACT: {b_exact:.2f}% -> {pct(exact):.2f}% | delta={pct(exact)-b_exact:+.2f} pp")
            for f in FIELDS:
                b = float(baseline["fields"][f]["pct"])
                print(f"{f}: {b:.2f}% -> {pct(fc[f]):.2f}% | delta={pct(fc[f])-b:+.2f} pp")
        except Exception:
            print("Baseline summary exists but delta parsing failed; posttrain result remains valid.")

    print(f"\nSummary: {OUT_SUMMARY}")
    print("Production: OFF")
    print("==============================================================")


if __name__ == "__main__":
    main()
