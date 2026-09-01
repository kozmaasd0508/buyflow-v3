from __future__ import annotations

import argparse
import gc
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from v11_fresh_blind_model import file_sha256, load_model, prompt_for_case, resolve_adapter, strict_prediction
from v11_fresh_blind_score import UNSAFE_PROMOTIONS
from v12_constrained_output import infer_constrained
from v12_hard_candidates_v1 import build_cases, canonical_jsonl, corpus_sha256


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _family_summary(cases: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, Any]:
    case_by_id = {case["case_id"]: case for case in cases}
    stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "exact": 0, "disagreement": 0, "unsafe": 0})
    for row in rows:
        case = case_by_id[row["case_id"]]
        family = case["metadata"]["family"]
        item = stats[family]
        item["total"] += 1
        if row["exact"]:
            item["exact"] += 1
        else:
            item["disagreement"] += 1
        if row["unsafe"]:
            item["unsafe"] += 1
    return dict(sorted(stats.items()))


def _review_queue(cases: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    case_by_id = {case["case_id"]: case for case in cases}
    row_by_id = {row["case_id"]: row for row in rows}
    selected: dict[str, str] = {}

    # Every student disagreement goes to the teacher.
    for row in rows:
        if not row["exact"]:
            selected[row["case_id"]] = "STUDENT_DISAGREEMENT"

    # Also audit at least one student agreement per family + target label so the
    # teacher is not only shown cases where the student already looks suspicious.
    seen: set[tuple[str, str]] = set()
    for case in cases:
        key = (case["metadata"]["family"], case["expected"]["event_type"])
        if key in seen:
            continue
        row = row_by_id[case["case_id"]]
        if row["exact"]:
            seen.add(key)
            selected.setdefault(case["case_id"], "AGREEMENT_AUDIT")

    queue: list[dict[str, Any]] = []
    for case in cases:
        reason = selected.get(case["case_id"])
        if not reason:
            continue
        row = row_by_id[case["case_id"]]
        queue.append({
            "case_id": case["case_id"],
            "review_reason": reason,
            "family": case["metadata"]["family"],
            "language": case["metadata"]["language"],
            "seed_expected": case["expected"],
            "student_prediction": row["prediction"],
            "student_exact_vs_seed": row["exact"],
            "student_unsafe_vs_seed": row["unsafe"],
            "document": case["document"],
            "teacher_status": "PENDING",
            "teacher_label": None,
            "teacher_rationale": None,
            "train_eligible": False,
            "synthetic": True,
            "deidentified": True,
        })
    return queue


def main() -> None:
    parser = argparse.ArgumentParser(description="Mine V12 hard candidates with unchanged V11 student")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    corpus_sha = corpus_sha256(cases)
    out_root = root / "local-data" / "lora-v12" / "teacher-candidates-v1"
    out_root.mkdir(parents=True, exist_ok=True)
    (out_root / "candidates.jsonl").write_bytes(canonical_jsonl(cases))
    (out_root / "CANDIDATE_SHA256.txt").write_text(corpus_sha + "\n", encoding="utf-8")

    run, adapter, _train_metrics = resolve_adapter(root, args.adapter_dir)
    adapter_sha = file_sha256(adapter / "adapter_model.safetensors")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = out_root / "runs" / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    partial = run_dir / "student-predictions.partial.jsonl"
    existing = _read_jsonl(partial)
    by_id = {row["case_id"]: row for row in existing}

    print("# BUYFLOW V12 STUDENT MINE V1")
    print(f"cases: {len(cases)}")
    print(f"candidate_sha256: {corpus_sha}")
    print(f"adapter_sha256: {adapter_sha}")
    print("training: False")
    print("teacher_call: False")
    print("frozen_holdout_rows_reused: False")
    print("synthetic_deidentified_only: True")
    print(f"resume_completed: {len(by_id)}/{len(cases)}")
    print("loading_model: Qwen3-8B NF4 + V11 adapter + constrained output")

    tokenizer, model = load_model(adapter)
    with partial.open("a", encoding="utf-8") as handle:
        for index, case in enumerate(cases, 1):
            if case["case_id"] in by_id:
                continue
            prompt, prompt_tokens = prompt_for_case(tokenizer, case)
            text, latency_ms = infer_constrained(tokenizer, model, prompt)
            prediction, error = strict_prediction(text)
            if error:
                raise RuntimeError(f"CONSTRAINED_OUTPUT_INVALID:{case['case_id']}:{error}")
            expected = case["expected"]
            exact = prediction == expected
            unsafe = bool(prediction and prediction["event_type"] in UNSAFE_PROMOTIONS.get(expected["event_type"], set()))
            row = {
                "case_id": case["case_id"],
                "expected": expected,
                "prediction": prediction,
                "error": None,
                "exact": exact,
                "unsafe": unsafe,
                "prompt_tokens": prompt_tokens,
                "latency_ms": round(latency_ms, 1),
            }
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
            by_id[case["case_id"]] = row
            if index % 12 == 0 or index == len(cases):
                print(f"progress: {len(by_id)}/{len(cases)}")

    rows = [by_id[case["case_id"]] for case in cases]
    exact = sum(1 for row in rows if row["exact"])
    unsafe = sum(1 for row in rows if row["unsafe"])
    disagreements = len(rows) - exact
    family_summary = _family_summary(cases, rows)
    queue = _review_queue(cases, rows)
    disagreement_queue = sum(1 for row in queue if row["review_reason"] == "STUDENT_DISAGREEMENT")
    audit_queue = sum(1 for row in queue if row["review_reason"] == "AGREEMENT_AUDIT")

    predictions = run_dir / "student-predictions.jsonl"
    with predictions.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    teacher_queue = run_dir / "teacher-review-queue.jsonl"
    with teacher_queue.open("w", encoding="utf-8") as handle:
        for row in queue:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    metrics = {
        "status": "V12_STUDENT_MINE_V1_COMPLETE",
        "candidate_sha256": corpus_sha,
        "candidate_count": len(cases),
        "adapter_sha256": adapter_sha,
        "training_run": str(run),
        "exact_vs_seed": exact,
        "disagreements_vs_seed": disagreements,
        "unsafe_vs_seed": unsafe,
        "family_summary": family_summary,
        "teacher_review_queue_count": len(queue),
        "teacher_disagreement_count": disagreement_queue,
        "teacher_agreement_audit_count": audit_queue,
        "teacher_call": False,
        "training": False,
        "train_eligible": False,
        "synthetic_deidentified_only": True,
        "frozen_holdout_rows_reused": False,
    }
    metrics_path = run_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_root / "LATEST_MINE.txt").write_text(str(run_dir) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    print(f"candidate_count: {len(cases)}")
    print(f"student_exact_vs_seed: {exact}/{len(cases)}")
    print(f"student_disagreements: {disagreements}")
    print(f"unsafe: {unsafe}")
    print(f"teacher_review_queue: {len(queue)}")
    print(f"  disagreements: {disagreement_queue}")
    print(f"  agreement_audits: {audit_queue}")
    for family, stats in family_summary.items():
        print(f"{family}: exact={stats['exact']}/{stats['total']} disagreements={stats['disagreement']} unsafe={stats['unsafe']}")
    print(f"teacher_queue_file: {teacher_queue}")
    print(f"metrics_file: {metrics_path}")
    print("status: V12_STUDENT_MINE_V1_COMPLETE")

    del model
    gc.collect()
    import torch
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
