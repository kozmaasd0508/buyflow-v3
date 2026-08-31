#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from v11_fresh_blind_config import ALLOWED, CASES_PER_EVENT, EXPECTED_FIXTURE_SHA256, MODEL_ID
from v11_fresh_blind_fixture import build_cases, canonical_jsonl
from v11_fresh_blind_model import file_sha256, infer, load_model, prompt_for_case, resolve_adapter, strict_prediction
from v11_fresh_blind_score import score


def main() -> None:
    parser = argparse.ArgumentParser(description="BuyFlow V11 Fresh Blind v1 evaluator")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    parser.add_argument("--freeze-only", action="store_true")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    raw = canonical_jsonl(cases)
    fixture_sha = hashlib.sha256(raw).hexdigest()
    if EXPECTED_FIXTURE_SHA256 != "PENDING" and fixture_sha != EXPECTED_FIXTURE_SHA256:
        raise RuntimeError(f"FRESH_BLIND_FIXTURE_DRIFT: {fixture_sha} != {EXPECTED_FIXTURE_SHA256}")

    out_root = root / "local-data" / "lora-v11" / "fresh-blind-v1"
    out_root.mkdir(parents=True, exist_ok=True)
    fixture_path = out_root / "fixtures.locked.jsonl"
    fixture_path.write_bytes(raw)
    (out_root / "FIXTURE_SHA256.txt").write_text(fixture_sha + "\n", encoding="utf-8")

    print("# BUYFLOW V11 FRESH BLIND V1")
    print(f"cases: {len(cases)}")
    print(f"events: {len(ALLOWED)} x {CASES_PER_EVENT}")
    print("document_shape: production NormalizedEmailDocumentV1")
    print("raw_customer_data: False")
    print("train_eligible: False")
    print(f"fixture_sha256: {fixture_sha}")
    print(f"fixture_file: {fixture_path}")
    if args.freeze_only:
        print("status: FRESH_BLIND_V1_FROZEN")
        return

    if EXPECTED_FIXTURE_SHA256 == "PENDING":
        raise RuntimeError("FRESH_BLIND_FIXTURE_NOT_FROZEN")

    run, adapter, train_metrics = resolve_adapter(root, args.adapter_dir)
    adapter_sha = file_sha256(adapter / "adapter_model.safetensors")
    print(f"v11_run: {run}")
    print(f"adapter_dir: {adapter}")
    print(f"adapter_sha256: {adapter_sha}")
    print(f"training_best_validation_loss: {train_metrics.get('best_validation_loss')}")

    import torch
    print(f"gpu_name: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'UNAVAILABLE'}")
    print("loading_model: Qwen3-8B NF4 + V11 adapter")
    tokenizer, model = load_model(adapter)

    prompt_tokens: list[int] = []
    rows: list[dict[str, object]] = []
    started = time.time()
    for index, case in enumerate(cases, 1):
        prompt, token_count = prompt_for_case(tokenizer, case)
        prompt_tokens.append(token_count)
        text, latency_ms = infer(tokenizer, model, prompt)
        prediction, error = strict_prediction(text)
        rows.append({
            "case_id": case["case_id"],
            "expected": case["expected"],
            "prediction": prediction,
            "error": error,
            "latency_ms": round(latency_ms, 1),
            "prompt_tokens": token_count,
        })
        if index % 10 == 0 or index == len(cases):
            print(f"eval_progress: {index}/{len(cases)}")

    elapsed = time.time() - started
    result = score(cases, rows)
    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    eval_dir = out_root / "runs" / run_stamp
    eval_dir.mkdir(parents=True, exist_ok=False)

    predictions_path = eval_dir / "predictions.jsonl"
    with predictions_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    metrics = {
        "status": "V11_FRESH_BLIND_V1_COMPLETE",
        "fixture_sha256": fixture_sha,
        "fixture_file": str(fixture_path),
        "fixture_cases": len(cases),
        "production_document_shape": "NormalizedEmailDocumentV1",
        "adapter_dir": str(adapter),
        "adapter_sha256": adapter_sha,
        "training_run": str(run),
        "model_id": MODEL_ID,
        "elapsed_seconds": elapsed,
        "prompt_tokens": {
            "min": min(prompt_tokens),
            "max": max(prompt_tokens),
            "mean": sum(prompt_tokens) / len(prompt_tokens),
        },
        "raw_customer_data": False,
        "train_eligible": False,
        "frozen_108_read": False,
        "blind_50_read": False,
        "real_gmail_holdout_read": False,
        **result,
    }
    metrics_path = eval_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_root / "LATEST_EVAL.txt").write_text(str(eval_dir) + "\n", encoding="utf-8")

    print("\n# RESULT")
    print(f"gate: {result['gate']}")
    print(f"exact: {result['exact_correct']}/{result['total']} ({100 * result['exact_accuracy']:.2f}%)")
    print(f"commerce: {result['commerce_correct']}/{result['total']} ({100 * result['commerce_accuracy']:.2f}%)")
    print(f"macro_event_accuracy: {100 * result['macro_event_accuracy']:.2f}%")
    print(f"invalid_output: {result['invalid_output_count']}")
    print(f"incoherent_output: {result['incoherent_output_count']}")
    print(f"unsafe_promotions: {result['unsafe_promotion_count']}")
    print(f"other_false_commerce: {result['other_false_commerce_count']}")
    print(f"critical_boundary_errors: {result['critical_boundary_error_count']}")
    print(f"elapsed_minutes: {elapsed / 60:.2f}")
    print(f"metrics_file: {metrics_path}")
    print("per_event:")
    for event in ALLOWED:
        event_result = result["per_event"][event]
        print(f"  {event}: {event_result['correct']}/{event_result['total']} ({100 * event_result['accuracy']:.1f}%)")
    print("status: V11_FRESH_BLIND_V1_COMPLETE")

    del model
    gc.collect()
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
