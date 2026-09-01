#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import hashlib
import json
from pathlib import Path
from typing import Any

from v11_fresh_blind_model import file_sha256, load_model, prompt_for_case, resolve_adapter, strict_prediction
from v11_fresh_blind_score import UNSAFE_PROMOTIONS
from v11_input_view_holdout_v2_fixture import EXPECTED_SHA256, build_cases, canonical_jsonl
from v12_constrained_output import infer_constrained


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _load_holdout_run(root: Path) -> tuple[Path, dict[str, Any], list[dict[str, Any]]]:
    out_root = root / "local-data" / "lora-v11" / "input-view-holdout-v2"
    latest = out_root / "LATEST_EVAL.txt"
    if not latest.is_file():
        raise RuntimeError(f"HOLDOUT_V2_LATEST_MISSING:{latest}")
    run_dir = Path(latest.read_text(encoding="utf-8").strip()).expanduser().resolve()
    metrics_path = run_dir / "metrics.json"
    predictions_path = run_dir / "predictions.jsonl"
    if not metrics_path.is_file() or not predictions_path.is_file():
        raise RuntimeError(f"HOLDOUT_V2_INCOMPLETE:{run_dir}")
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != "V11_INPUT_VIEW_HOLDOUT_V2_COMPLETE":
        raise RuntimeError(f"HOLDOUT_V2_STATUS:{metrics.get('status')}")
    if metrics.get("fixture_sha256") != EXPECTED_SHA256:
        raise RuntimeError("HOLDOUT_V2_FIXTURE_MISMATCH")
    return run_dir, metrics, _read_jsonl(predictions_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="BuyFlow V12 constrained-output diagnostic on V11 holdout")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=None)
    parser.add_argument("--all", action="store_true", help="Diagnostic only: rerun all 180 instead of only invalid FULL rows")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    fixture_sha = hashlib.sha256(canonical_jsonl(cases)).hexdigest()
    if fixture_sha != EXPECTED_SHA256:
        raise RuntimeError(f"HOLDOUT_V2_FIXTURE_DRIFT:{fixture_sha}")

    run_dir, holdout_metrics, combined_rows = _load_holdout_run(root)
    combined_by_id = {row["case_id"]: row for row in combined_rows}
    if len(combined_by_id) != len(cases):
        raise RuntimeError(f"HOLDOUT_V2_ROW_COUNT:{len(combined_by_id)}!={len(cases)}")

    run, adapter, _train_metrics = resolve_adapter(root, args.adapter_dir)
    adapter_sha = file_sha256(adapter / "adapter_model.safetensors")
    if adapter_sha != holdout_metrics.get("adapter_sha256"):
        raise RuntimeError("ADAPTER_SHA_MISMATCH")

    selected: list[dict[str, Any]] = []
    for case in cases:
        baseline = combined_by_id[case["case_id"]]["full"]
        if args.all or baseline.get("error"):
            selected.append(case)

    print("# BUYFLOW V12 OUTPUT CONSTRAINT PROBE V1")
    print(f"source_run: {run_dir}")
    print(f"fixture_sha256: {fixture_sha}")
    print(f"adapter_sha256: {adapter_sha}")
    print(f"mode: {'ALL_180' if args.all else 'INVALID_ONLY'}")
    print(f"selected_cases: {len(selected)}")
    print("training: False")
    print("fixture_mutation: False")
    print("purpose: eliminate malformed generative outputs without changing V11 weights")

    if not selected:
        print("status: NOTHING_TO_TEST")
        return

    tokenizer, model = load_model(adapter)
    rows: list[dict[str, Any]] = []
    exact = 0
    constrained_invalid = 0
    unsafe = 0
    changed_from_valid_baseline = 0

    for index, case in enumerate(selected, 1):
        baseline = combined_by_id[case["case_id"]]["full"]
        prompt, prompt_tokens = prompt_for_case(tokenizer, case)
        text, latency_ms = infer_constrained(tokenizer, model, prompt)
        prediction, error = strict_prediction(text)
        if error:
            constrained_invalid += 1
        expected = case["expected"]
        is_exact = error is None and prediction == expected
        if is_exact:
            exact += 1
        if prediction and prediction["event_type"] in UNSAFE_PROMOTIONS.get(expected["event_type"], set()):
            unsafe += 1
        if not baseline.get("error") and prediction != baseline.get("prediction"):
            changed_from_valid_baseline += 1

        rows.append({
            "case_id": case["case_id"],
            "expected": expected,
            "baseline_prediction": baseline.get("prediction"),
            "baseline_error": baseline.get("error"),
            "constrained_prediction": prediction,
            "constrained_error": error,
            "constrained_text": text,
            "exact": is_exact,
            "prompt_tokens": prompt_tokens,
            "latency_ms": round(latency_ms, 1),
        })
        print(
            f"case {index}/{len(selected)} {case['case_id']} expected={expected['event_type']} "
            f"baseline_error={baseline.get('error')} constrained={prediction} error={error} exact={is_exact}"
        )

    if constrained_invalid != 0:
        raise RuntimeError(f"CONSTRAINED_DECODER_BROKE_SCHEMA:{constrained_invalid}")

    report = {
        "status": "V12_OUTPUT_CONSTRAINT_PROBE_V1_COMPLETE",
        "diagnostic_only": True,
        "training": False,
        "fixture_mutation": False,
        "do_not_train_on_fixture": True,
        "source_run": str(run_dir),
        "training_run": str(run),
        "fixture_sha256": fixture_sha,
        "adapter_sha256": adapter_sha,
        "mode": "ALL_180" if args.all else "INVALID_ONLY",
        "selected_cases": len(selected),
        "exact_correct": exact,
        "constrained_invalid_output_count": constrained_invalid,
        "unsafe_promotion_count": unsafe,
        "changed_from_valid_baseline_count": changed_from_valid_baseline,
        "rows": rows,
    }
    out = run_dir / ("v12-output-constraint-all-v1.json" if args.all else "v12-output-constraint-invalid-v1.json")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    print(f"selected_cases: {len(selected)}")
    print(f"exact_correct: {exact}/{len(selected)}")
    print(f"constrained_invalid_output: {constrained_invalid}")
    print(f"unsafe_promotions: {unsafe}")
    print(f"changed_from_valid_baseline: {changed_from_valid_baseline}")
    print(f"report_file: {out}")
    print("status: V12_OUTPUT_CONSTRAINT_PROBE_V1_COMPLETE")

    del model
    gc.collect()
    import torch
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
