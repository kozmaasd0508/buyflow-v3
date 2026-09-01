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
from typing import Any

from v11_fresh_blind_config import ALLOWED, EXPECTED_FIXTURE_SHA256, MODEL_ID
from v11_fresh_blind_fixture import build_cases, canonical_jsonl
from v11_fresh_blind_model import file_sha256, infer, load_model, resolve_adapter, strict_prediction
from v11_fresh_blind_score import score
from v11_semantic_view_v1 import semantic_prompt_for_case


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _exact(case: dict[str, Any], row: dict[str, Any]) -> bool:
    return not row.get("error") and row.get("prediction") == case["expected"]


def load_locked_baseline(
    root: Path, cases: list[dict[str, Any]], fixture_sha: str, adapter_sha: str
) -> tuple[Path, list[dict[str, Any]], dict[str, Any]]:
    latest = root / "local-data" / "lora-v11" / "fresh-blind-v1" / "LATEST_EVAL.txt"
    if not latest.is_file():
        raise RuntimeError(f"FRESH_BLIND_BASELINE_MISSING: {latest}")
    baseline_dir = Path(latest.read_text(encoding="utf-8").strip()).expanduser()
    metrics_path = baseline_dir / "metrics.json"
    predictions_path = baseline_dir / "predictions.jsonl"
    if not metrics_path.is_file() or not predictions_path.is_file():
        raise RuntimeError(f"FRESH_BLIND_BASELINE_INCOMPLETE: {baseline_dir}")

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != "V11_FRESH_BLIND_V1_COMPLETE":
        raise RuntimeError(f"FRESH_BLIND_BASELINE_STATUS: {metrics.get('status')}")
    if metrics.get("fixture_sha256") != fixture_sha:
        raise RuntimeError("FRESH_BLIND_BASELINE_FIXTURE_MISMATCH")
    if metrics.get("adapter_sha256") != adapter_sha:
        raise RuntimeError("FRESH_BLIND_BASELINE_ADAPTER_MISMATCH")

    rows = _read_jsonl(predictions_path)
    by_id = {row.get("case_id"): row for row in rows}
    ordered: list[dict[str, Any]] = []
    for case in cases:
        row = by_id.get(case["case_id"])
        if not isinstance(row, dict):
            raise RuntimeError(f"FRESH_BLIND_BASELINE_CASE_MISSING: {case['case_id']}")
        ordered.append(row)
    if len(by_id) != len(cases):
        raise RuntimeError(f"FRESH_BLIND_BASELINE_ROW_COUNT: {len(by_id)} != {len(cases)}")
    return baseline_dir, ordered, metrics


def get_working_run(out_root: Path, fixture_sha: str, adapter_sha: str) -> tuple[Path, dict[str, Any]]:
    current = out_root / "CURRENT_RUN.txt"
    if current.is_file():
        candidate = Path(current.read_text(encoding="utf-8").strip()).expanduser()
        manifest_path = candidate / "run-manifest.json"
        if candidate.is_dir() and manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (
                manifest.get("status") == "RUNNING"
                and manifest.get("fixture_sha256") == fixture_sha
                and manifest.get("adapter_sha256") == adapter_sha
            ):
                return candidate, manifest

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = out_root / "runs" / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    manifest = {
        "status": "RUNNING",
        "fixture_sha256": fixture_sha,
        "adapter_sha256": adapter_sha,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (run_dir / "run-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    current.write_text(str(run_dir) + "\n", encoding="utf-8")
    return run_dir, manifest


def paired_summary(
    cases: list[dict[str, Any]],
    baseline_rows: list[dict[str, Any]],
    semantic_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    both_correct = 0
    baseline_only = 0
    semantic_only = 0
    both_wrong = 0
    prediction_changed = 0
    per_event: dict[str, dict[str, int]] = {
        event: {"baseline_only": 0, "semantic_only": 0, "both_correct": 0, "both_wrong": 0}
        for event in ALLOWED
    }

    for case, baseline, semantic in zip(cases, baseline_rows, semantic_rows):
        b_ok = _exact(case, baseline)
        s_ok = _exact(case, semantic)
        event = case["expected"]["event_type"]
        if b_ok and s_ok:
            both_correct += 1
            per_event[event]["both_correct"] += 1
        elif b_ok:
            baseline_only += 1
            per_event[event]["baseline_only"] += 1
        elif s_ok:
            semantic_only += 1
            per_event[event]["semantic_only"] += 1
        else:
            both_wrong += 1
            per_event[event]["both_wrong"] += 1
        if baseline.get("prediction") != semantic.get("prediction") or baseline.get("error") != semantic.get("error"):
            prediction_changed += 1

    return {
        "both_correct": both_correct,
        "baseline_only_correct": baseline_only,
        "semantic_only_correct": semantic_only,
        "both_wrong": both_wrong,
        "net_exact_wins": semantic_only - baseline_only,
        "prediction_changed_count": prediction_changed,
        "per_event": per_event,
    }


def diagnostic_recommendation(baseline: dict[str, Any], semantic: dict[str, Any], paired: dict[str, Any]) -> str:
    no_safety_regression = (
        semantic["unsafe_promotion_count"] <= baseline["unsafe_promotion_count"]
        and semantic["other_false_commerce_count"] <= baseline["other_false_commerce_count"]
        and semantic["incoherent_output_count"] <= baseline["incoherent_output_count"]
    )
    formatting_no_worse = semantic["invalid_output_count"] <= baseline["invalid_output_count"]
    if no_safety_regression and formatting_no_worse and paired["net_exact_wins"] > 0:
        return "SEMANTIC_VIEW_PROMISING_REQUIRES_NEW_UNTOUCHED_HOLDOUT"
    if no_safety_regression and formatting_no_worse and paired["net_exact_wins"] == 0:
        return "NO_CLEAR_ACCURACY_GAIN_REQUIRES_NEW_UNTOUCHED_HOLDOUT"
    return "SEMANTIC_VIEW_NOT_READY"


def main() -> None:
    parser = argparse.ArgumentParser(description="BuyFlow V11 SemanticEmailView A/B diagnostic")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    raw = canonical_jsonl(cases)
    fixture_sha = hashlib.sha256(raw).hexdigest()
    if fixture_sha != EXPECTED_FIXTURE_SHA256:
        raise RuntimeError(f"FRESH_BLIND_FIXTURE_DRIFT: {fixture_sha} != {EXPECTED_FIXTURE_SHA256}")

    run, adapter, train_metrics = resolve_adapter(root, args.adapter_dir)
    adapter_sha = file_sha256(adapter / "adapter_model.safetensors")
    baseline_dir, baseline_rows, baseline_metrics = load_locked_baseline(
        root, cases, fixture_sha, adapter_sha
    )
    baseline_result = score(cases, baseline_rows)

    out_root = root / "local-data" / "lora-v11" / "semantic-view-ab-v1"
    out_root.mkdir(parents=True, exist_ok=True)
    run_dir, manifest = get_working_run(out_root, fixture_sha, adapter_sha)
    partial_path = run_dir / "semantic-predictions.partial.jsonl"
    completed_rows = _read_jsonl(partial_path)
    completed_by_id = {row.get("case_id"): row for row in completed_rows}

    print("# BUYFLOW V11 SEMANTIC EMAIL VIEW A/B V1")
    print(f"cases: {len(cases)}")
    print(f"fixture_sha256: {fixture_sha}")
    print(f"adapter_sha256: {adapter_sha}")
    print(f"baseline_dir: {baseline_dir}")
    print(f"baseline_exact: {baseline_result['exact_correct']}/{baseline_result['total']}")
    print("baseline_reused: True")
    print("training: False")
    print("diagnostic_only: True")
    print(f"resume_completed: {len(completed_by_id)}/{len(cases)}")
    print("semantic_view: BuyFlowSemanticEmailViewV1")
    print("same_instruction: True")

    missing = [case for case in cases if case["case_id"] not in completed_by_id]
    model = None
    started = time.time()
    if missing:
        import torch

        print(f"gpu_name: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'UNAVAILABLE'}")
        print("loading_model: Qwen3-8B NF4 + V11 adapter")
        tokenizer, model = load_model(adapter)

        with partial_path.open("a", encoding="utf-8") as handle:
            for case in missing:
                prompt, token_count = semantic_prompt_for_case(tokenizer, case)
                text, latency_ms = infer(tokenizer, model, prompt)
                prediction, error = strict_prediction(text)
                row = {
                    "case_id": case["case_id"],
                    "expected": case["expected"],
                    "prediction": prediction,
                    "error": error,
                    "latency_ms": round(latency_ms, 1),
                    "prompt_tokens": token_count,
                }
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
                completed_by_id[case["case_id"]] = row
                done = len(completed_by_id)
                if done % 10 == 0 or done == len(cases):
                    print(f"semantic_eval_progress: {done}/{len(cases)}")

    semantic_rows = [completed_by_id[case["case_id"]] for case in cases]
    semantic_result = score(cases, semantic_rows)
    paired = paired_summary(cases, baseline_rows, semantic_rows)
    recommendation = diagnostic_recommendation(baseline_result, semantic_result, paired)
    elapsed = time.time() - started

    combined_path = run_dir / "predictions.jsonl"
    with combined_path.open("w", encoding="utf-8") as handle:
        for case, baseline, semantic in zip(cases, baseline_rows, semantic_rows):
            handle.write(
                json.dumps(
                    {
                        "case_id": case["case_id"],
                        "expected": case["expected"],
                        "metadata": case["metadata"],
                        "baseline": baseline,
                        "semantic": semantic,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "\n"
            )

    token_counts = [int(row["prompt_tokens"]) for row in semantic_rows]
    metrics = {
        "status": "V11_SEMANTIC_VIEW_AB_V1_COMPLETE",
        "diagnostic_only": True,
        "do_not_train_on_fixture": True,
        "fixture_sha256": fixture_sha,
        "adapter_sha256": adapter_sha,
        "adapter_dir": str(adapter),
        "training_run": str(run),
        "training_best_validation_loss": train_metrics.get("best_validation_loss"),
        "model_id": MODEL_ID,
        "baseline_source": str(baseline_dir),
        "baseline_original_gate": baseline_metrics.get("gate"),
        "semantic_view": "BuyFlowSemanticEmailViewV1",
        "same_instruction": True,
        "semantic_prompt_tokens": {
            "min": min(token_counts),
            "max": max(token_counts),
            "mean": sum(token_counts) / len(token_counts),
        },
        "baseline": baseline_result,
        "semantic": semantic_result,
        "paired": paired,
        "exact_accuracy_delta": semantic_result["exact_accuracy"] - baseline_result["exact_accuracy"],
        "macro_event_accuracy_delta": semantic_result["macro_event_accuracy"] - baseline_result["macro_event_accuracy"],
        "invalid_output_delta": semantic_result["invalid_output_count"] - baseline_result["invalid_output_count"],
        "unsafe_promotion_delta": semantic_result["unsafe_promotion_count"] - baseline_result["unsafe_promotion_count"],
        "critical_boundary_error_delta": semantic_result["critical_boundary_error_count"] - baseline_result["critical_boundary_error_count"],
        "recommendation": recommendation,
        "elapsed_seconds_this_process": elapsed,
        "frozen_108_read": False,
        "blind_50_read": False,
        "real_gmail_holdout_read": False,
    }
    metrics_path = run_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest["status"] = "COMPLETE"
    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    (run_dir / "run-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out_root / "LATEST_EVAL.txt").write_text(str(run_dir) + "\n", encoding="utf-8")
    current = out_root / "CURRENT_RUN.txt"
    if current.is_file():
        current.unlink()

    print("\n# RESULT")
    print(
        f"BASELINE exact: {baseline_result['exact_correct']}/{baseline_result['total']} "
        f"({100 * baseline_result['exact_accuracy']:.2f}%)"
    )
    print(
        f"SEMANTIC exact: {semantic_result['exact_correct']}/{semantic_result['total']} "
        f"({100 * semantic_result['exact_accuracy']:.2f}%)"
    )
    print(f"SEMANTIC macro: {100 * semantic_result['macro_event_accuracy']:.2f}%")
    print(f"invalid: {baseline_result['invalid_output_count']} -> {semantic_result['invalid_output_count']}")
    print(f"unsafe_promotions: {baseline_result['unsafe_promotion_count']} -> {semantic_result['unsafe_promotion_count']}")
    print(
        f"critical_boundary_errors: {baseline_result['critical_boundary_error_count']} -> "
        f"{semantic_result['critical_boundary_error_count']}"
    )
    print(
        f"paired_wins: semantic={paired['semantic_only_correct']} baseline={paired['baseline_only_correct']} "
        f"net={paired['net_exact_wins']:+d}"
    )
    print(f"recommendation: {recommendation}")
    print(f"metrics_file: {metrics_path}")
    print("status: V11_SEMANTIC_VIEW_AB_V1_COMPLETE")

    if model is not None:
        del model
        gc.collect()
        import torch

        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
