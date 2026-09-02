from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from v11_fresh_blind_model import file_sha256, load_model, prompt_for_case, resolve_adapter, strict_prediction
from v12_constrained_output import infer_constrained


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Score unchanged V11 on V12 hard-sibling validation rows")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    corpus_dir = root / "local-data" / "lora-v12" / "hard-siblings-v2"
    cases_path = corpus_dir / "cases.jsonl"
    metrics_path = corpus_dir / "metrics.json"
    sha_path = corpus_dir / "CORPUS_SHA256.txt"
    for required in (cases_path, metrics_path, sha_path):
        if not required.is_file():
            raise FileNotFoundError(f"CORPUS_FILE_MISSING:{required}")

    corpus_metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if corpus_metrics.get("status") != "V12_HARD_SIBLINGS_V2_CORPUS_READY":
        raise RuntimeError(f"CORPUS_STATUS_NOT_READY:{corpus_metrics.get('status')}")
    expected_sha = sha_path.read_text(encoding="utf-8").strip()
    actual_sha = _sha256(cases_path)
    if actual_sha != expected_sha:
        raise RuntimeError(f"CORPUS_SHA_MISMATCH:{actual_sha}!={expected_sha}")

    all_cases = _read_jsonl(cases_path)
    cases = [row for row in all_cases if row.get("split") == "VALIDATION"]
    if len(cases) != 72:
        raise RuntimeError(f"VALIDATION_COUNT:{len(cases)}!=72")
    if any(row.get("metadata", {}).get("train_eligible") for row in cases):
        raise RuntimeError("VALIDATION_ROW_MARKED_TRAIN_ELIGIBLE")

    run, adapter, _train_metrics = resolve_adapter(root, args.adapter_dir)
    adapter_sha = file_sha256(adapter / "adapter_model.safetensors")

    out_root = corpus_dir / "baseline-v11"
    out_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = out_root / "runs" / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    partial = run_dir / "predictions.partial.jsonl"

    print("# BUYFLOW V12 HARD SIBLINGS V2 - V11 BASELINE")
    print(f"corpus_sha256: {actual_sha}")
    print(f"validation_cases: {len(cases)}")
    print(f"adapter_sha256: {adapter_sha}")
    print("training: False")
    print("corpus_mutation: False")
    print("frozen_holdouts_read: False")
    print("loading_model: Qwen3-8B NF4 + V11 adapter + constrained output")

    tokenizer, model = load_model(adapter)
    rows: list[dict[str, Any]] = []
    with partial.open("w", encoding="utf-8") as handle:
        for index, case in enumerate(cases, 1):
            prompt, prompt_tokens = prompt_for_case(tokenizer, case)
            text, latency_ms = infer_constrained(tokenizer, model, prompt)
            prediction, error = strict_prediction(text)
            if error:
                raise RuntimeError(f"CONSTRAINED_OUTPUT_INVALID:{case['case_id']}:{error}")
            expected = case["expected"]
            exact = prediction == expected
            row = {
                "case_id": case["case_id"],
                "expected": expected,
                "prediction": prediction,
                "exact": exact,
                "language": case["metadata"]["language"],
                "representation_variant": case["metadata"]["representation_variant"],
                "semantic_group": case["metadata"]["semantic_group"],
                "prompt_tokens": prompt_tokens,
                "latency_ms": round(latency_ms, 1),
            }
            rows.append(row)
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
            if index % 12 == 0 or index == len(cases):
                print(f"progress: {index}/{len(cases)}")

    exact_count = sum(1 for row in rows if row["exact"])
    wrong = len(rows) - exact_count
    transitions = Counter(
        (row["expected"]["event_type"], row["prediction"]["event_type"])
        for row in rows if not row["exact"]
    )

    per_event: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "exact": 0})
    per_variant: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "exact": 0})
    per_language: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "exact": 0})
    for row in rows:
        event = row["expected"]["event_type"]
        variant = row["representation_variant"]
        language = row["language"]
        per_event[event]["total"] += 1
        per_variant[variant]["total"] += 1
        per_language[language]["total"] += 1
        if row["exact"]:
            per_event[event]["exact"] += 1
            per_variant[variant]["exact"] += 1
            per_language[language]["exact"] += 1

    final_predictions = run_dir / "predictions.jsonl"
    with final_predictions.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    result = {
        "status": "V12_HARD_SIBLINGS_V2_V11_BASELINE_COMPLETE",
        "corpus_sha256": actual_sha,
        "validation_cases": len(cases),
        "exact": exact_count,
        "wrong": wrong,
        "accuracy": exact_count / len(cases),
        "adapter_sha256": adapter_sha,
        "training_run": str(run),
        "training": False,
        "corpus_mutation": False,
        "frozen_holdouts_read": False,
        "per_event": dict(sorted(per_event.items())),
        "per_variant": dict(sorted(per_variant.items())),
        "per_language": dict(sorted(per_language.items())),
        "wrong_transitions": {f"{a}->{b}": count for (a, b), count in sorted(transitions.items())},
    }
    result_path = run_dir / "metrics.json"
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_root / "LATEST_EVAL.txt").write_text(str(run_dir) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    print(f"validation_cases: {len(cases)}")
    print(f"exact: {exact_count}/{len(cases)} ({100.0 * exact_count / len(cases):.2f}%)")
    print("invalid: 0")
    print(f"wrong: {wrong}")
    for event, stats in sorted(per_event.items()):
        print(f"{event}: {stats['exact']}/{stats['total']}")
    print("# BY_VARIANT")
    for variant, stats in sorted(per_variant.items()):
        print(f"{variant}: {stats['exact']}/{stats['total']}")
    print("# WRONG_TRANSITIONS")
    if transitions:
        for (expected, predicted), count in sorted(transitions.items()):
            print(f"{expected}->{predicted}: {count}")
    else:
        print("none")
    print(f"metrics_file: {result_path}")
    print("status: V12_HARD_SIBLINGS_V2_V11_BASELINE_COMPLETE")

    del model
    gc.collect()
    import torch
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
