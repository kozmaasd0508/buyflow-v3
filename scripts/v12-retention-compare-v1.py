from __future__ import annotations

import gc
import hashlib
import json
import os
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from v11_fresh_blind_config import ALLOWED, MAX_PROMPT_TOKENS
from v11_fresh_blind_model import file_sha256, load_model, strict_prediction, tokenizer_template
from v12_constrained_output import infer_constrained

EXPECTED_VALIDATION_SHA = "d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6"
EXPECTED_V11_ADAPTER_SHA = "462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b"
EXPECTED_V12_ADAPTER_SHA = "5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630"
PARENT_RUN_NAME = "20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic"
EXPECTED_V12_STATUS = "LORA_V12_RETENTION_ROBUSTNESS_TRAIN_COMPLETE"
EXPECTED_ROWS = 288
EXPECTED_PER_EVENT = 16


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def expected_for(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("output")
    if not isinstance(value, str):
        raise RuntimeError(f"ROW_OUTPUT_NOT_STRING:{row.get('case_id')}")
    obj = json.loads(value)
    if not isinstance(obj, dict) or set(obj) != {"is_commerce", "event_type"}:
        raise RuntimeError(f"ROW_OUTPUT_SCHEMA:{row.get('case_id')}")
    if obj["event_type"] not in ALLOWED or not isinstance(obj["is_commerce"], bool):
        raise RuntimeError(f"ROW_OUTPUT_VALUES:{row.get('case_id')}")
    return obj


def prompt_for_row(tokenizer: Any, row: dict[str, Any]) -> tuple[str, int]:
    instruction = row.get("instruction")
    document = row.get("input")
    if not isinstance(instruction, str) or not instruction.strip():
        raise RuntimeError(f"ROW_INSTRUCTION_MISSING:{row.get('case_id')}")
    if not isinstance(document, str) or not document.strip():
        raise RuntimeError(f"ROW_INPUT_MISSING:{row.get('case_id')}")
    user = f"{instruction}\n\nEMAIL_DOCUMENT:\n{document}"
    prompt = tokenizer_template(tokenizer, [{"role": "user", "content": user}], True)
    token_count = len(tokenizer(prompt, add_special_tokens=False)["input_ids"])
    if token_count > MAX_PROMPT_TOKENS:
        raise RuntimeError(f"PROMPT_TOO_LONG:{row.get('case_id')}:{token_count}>{MAX_PROMPT_TOKENS}")
    return prompt, token_count


def resolve_v11(root: Path) -> tuple[Path, Path, dict[str, Any]]:
    run = root / "local-data" / "lora-v11" / "runs" / PARENT_RUN_NAME
    adapter = run / "best"
    metrics_path = run / "metrics.json"
    weights = adapter / "adapter_model.safetensors"
    if not metrics_path.is_file() or not weights.is_file():
        raise RuntimeError(f"V11_PARENT_MISSING:{run}")
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != "LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE":
        raise RuntimeError(f"V11_STATUS:{metrics.get('status')}")
    for key in ("frozen_108_trained", "blind_50_trained", "locked_test_read", "locked_test_trained"):
        if metrics.get(key) is not False:
            raise RuntimeError(f"V11_SAFETY_GATE:{key}")
    actual = file_sha256(weights)
    if actual != EXPECTED_V11_ADAPTER_SHA:
        raise RuntimeError(f"V11_ADAPTER_SHA_MISMATCH:{actual}")
    return run, adapter, metrics


def resolve_v12(root: Path) -> tuple[Path, Path, dict[str, Any]]:
    latest = root / "local-data" / "lora-v12" / "LATEST.txt"
    if not latest.is_file():
        raise RuntimeError(f"V12_LATEST_MISSING:{latest}")
    run = Path(latest.read_text(encoding="utf-8").strip()).expanduser().resolve()
    adapter = run / "best"
    metrics_path = run / "metrics.json"
    weights = adapter / "adapter_model.safetensors"
    if not metrics_path.is_file() or not weights.is_file():
        raise RuntimeError(f"V12_RUN_INCOMPLETE:{run}")
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != EXPECTED_V12_STATUS:
        raise RuntimeError(f"V12_STATUS:{metrics.get('status')}")
    if metrics.get("best_adapter_sha256") != EXPECTED_V12_ADAPTER_SHA:
        raise RuntimeError(f"V12_RECORDED_ADAPTER_SHA:{metrics.get('best_adapter_sha256')}")
    if metrics.get("parent_adapter_sha256") != EXPECTED_V11_ADAPTER_SHA:
        raise RuntimeError(f"V12_RECORDED_PARENT_SHA:{metrics.get('parent_adapter_sha256')}")
    for key in (
        "frozen_holdouts_read",
        "fresh_blind_read",
        "input_view_holdout_read",
        "frozen108_trained",
        "blind50_trained",
        "locked_test_read",
        "locked_test_trained",
    ):
        if metrics.get(key) is not False:
            raise RuntimeError(f"V12_SAFETY_GATE:{key}")
    actual = file_sha256(weights)
    if actual != EXPECTED_V12_ADAPTER_SHA:
        raise RuntimeError(f"V12_ADAPTER_SHA_MISMATCH:{actual}")
    return run, adapter, metrics


def score_model(name: str, adapter: Path, rows: list[dict[str, Any]], out_file: Path) -> list[dict[str, Any]]:
    print(f"loading_{name.lower()}: Qwen3-8B NF4 + {name} adapter + constrained output", flush=True)
    tokenizer, model = load_model(adapter)
    scored: list[dict[str, Any]] = []
    try:
        with out_file.open("w", encoding="utf-8") as handle:
            for index, row in enumerate(rows, 1):
                prompt, prompt_tokens = prompt_for_row(tokenizer, row)
                text, latency_ms = infer_constrained(tokenizer, model, prompt)
                prediction, error = strict_prediction(text)
                if error or prediction is None:
                    raise RuntimeError(f"CONSTRAINED_OUTPUT_INVALID:{name}:{row.get('case_id')}:{error}")
                expected = expected_for(row)
                item = {
                    "model": name,
                    "case_id": row.get("case_id"),
                    "expected": expected,
                    "prediction": prediction,
                    "exact": prediction == expected,
                    "event_type": expected["event_type"],
                    "prompt_tokens": prompt_tokens,
                    "latency_ms": round(latency_ms, 1),
                }
                scored.append(item)
                handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
                if index % 32 == 0 or index == len(rows):
                    print(f"{name.lower()}_progress: {index}/{len(rows)}", flush=True)
    finally:
        del model
        gc.collect()
        import torch
        torch.cuda.empty_cache()
    return scored


def summarize(rows: list[dict[str, Any]]) -> tuple[int, dict[str, dict[str, int]], Counter[tuple[str, str]]]:
    exact = sum(1 for row in rows if row["exact"])
    per_event: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "exact": 0})
    transitions: Counter[tuple[str, str]] = Counter()
    for row in rows:
        event = row["expected"]["event_type"]
        per_event[event]["total"] += 1
        if row["exact"]:
            per_event[event]["exact"] += 1
        else:
            transitions[(event, row["prediction"]["event_type"])] += 1
    return exact, dict(per_event), transitions


def main() -> None:
    if len(os.sys.argv) != 2:
        raise SystemExit("Usage: v12-retention-compare-v1.py <project-root>")
    root = Path(os.sys.argv[1]).resolve()

    replay_root = root / "local-data" / "lora-v12" / "retention-replay-v1"
    manifest_path = replay_root / "manifest.json"
    validation_path = replay_root / "validation.merged.sft.jsonl"
    if not manifest_path.is_file() or not validation_path.is_file():
        raise RuntimeError(f"RETENTION_FILES_MISSING:{replay_root}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") != "V12_RETENTION_REPLAY_V1_READY":
        raise RuntimeError(f"RETENTION_STATUS:{manifest.get('status')}")
    for key in ("frozen_holdouts_read", "fresh_blind_read", "input_view_holdout_read", "frozen108_read", "blind50_read"):
        if manifest.get(key) is not False:
            raise RuntimeError(f"RETENTION_SAFETY_GATE:{key}")
    actual_validation_sha = sha256_file(validation_path)
    if actual_validation_sha != EXPECTED_VALIDATION_SHA:
        raise RuntimeError(f"RETENTION_VALIDATION_SHA_MISMATCH:{actual_validation_sha}")

    merged = read_jsonl(validation_path)
    rows = [row for row in merged if row.get("metadata", {}).get("v12_source") == "V11_REPLAY_VALIDATION"]
    if len(rows) != EXPECTED_ROWS:
        raise RuntimeError(f"RETENTION_ROW_COUNT:{len(rows)}!={EXPECTED_ROWS}")
    dist = Counter(expected_for(row)["event_type"] for row in rows)
    if set(dist) != set(ALLOWED) or any(dist[event] != EXPECTED_PER_EVENT for event in ALLOWED):
        raise RuntimeError(f"RETENTION_EVENT_DISTRIBUTION:{dict(dist)}")

    v11_run, v11_adapter, _ = resolve_v11(root)
    v12_run, v12_adapter, _ = resolve_v12(root)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = replay_root / "retention-compare" / "runs" / stamp
    out.mkdir(parents=True, exist_ok=False)

    print("# BUYFLOW V12 ALL-18 RETENTION COMPARE")
    print(f"validation_sha256: {actual_validation_sha}")
    print(f"rows: {len(rows)}")
    print("per_event: 16")
    print("source: V11_REPLAY_VALIDATION only")
    print("development_validation: True")
    print("training: False")
    print("corpus_mutation: False")
    print("frozen_holdouts_read: False")
    print(f"v11_adapter_sha256: {EXPECTED_V11_ADAPTER_SHA}")
    print(f"v12_adapter_sha256: {EXPECTED_V12_ADAPTER_SHA}")
    print(f"v11_run: {v11_run}")
    print(f"v12_run: {v12_run}")

    started = time.time()
    v11_rows = score_model("V11", v11_adapter, rows, out / "v11.predictions.jsonl")
    v12_rows = score_model("V12", v12_adapter, rows, out / "v12.predictions.jsonl")
    elapsed = time.time() - started

    v11_exact, v11_event, v11_transitions = summarize(v11_rows)
    v12_exact, v12_event, v12_transitions = summarize(v12_rows)

    event_compare: dict[str, Any] = {}
    for event in sorted(ALLOWED):
        a = v11_event[event]["exact"]
        b = v12_event[event]["exact"]
        event_compare[event] = {"total": EXPECTED_PER_EVENT, "v11_exact": a, "v12_exact": b, "delta": b - a}

    result = {
        "status": "V12_ALL18_RETENTION_COMPARE_COMPLETE",
        "development_validation": True,
        "training": False,
        "corpus_mutation": False,
        "frozen_holdouts_read": False,
        "validation_sha256": actual_validation_sha,
        "rows": len(rows),
        "per_event": EXPECTED_PER_EVENT,
        "v11_adapter_sha256": EXPECTED_V11_ADAPTER_SHA,
        "v12_adapter_sha256": EXPECTED_V12_ADAPTER_SHA,
        "v11_exact": v11_exact,
        "v12_exact": v12_exact,
        "delta_exact": v12_exact - v11_exact,
        "event_compare": event_compare,
        "v11_wrong_transitions": {f"{a}->{b}": n for (a, b), n in sorted(v11_transitions.items())},
        "v12_wrong_transitions": {f"{a}->{b}": n for (a, b), n in sorted(v12_transitions.items())},
        "elapsed_minutes": elapsed / 60.0,
    }
    metrics_path = out / "metrics.json"
    metrics_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    latest = replay_root / "retention-compare" / "LATEST_EVAL.txt"
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(str(out) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    print(f"V11: {v11_exact}/{len(rows)} ({100.0*v11_exact/len(rows):.2f}%)")
    print(f"V12: {v12_exact}/{len(rows)} ({100.0*v12_exact/len(rows):.2f}%)")
    print(f"delta_exact: {v12_exact-v11_exact:+d}")
    print("invalid_v11: 0")
    print("invalid_v12: 0")
    print("# BY_EVENT")
    for event in sorted(ALLOWED):
        info = event_compare[event]
        print(f"{event}: V11={info['v11_exact']}/{EXPECTED_PER_EVENT} V12={info['v12_exact']}/{EXPECTED_PER_EVENT} delta={info['delta']:+d}")
    print("# V11_WRONG_TRANSITIONS")
    if v11_transitions:
        for (expected, predicted), count in sorted(v11_transitions.items()):
            print(f"{expected}->{predicted}: {count}")
    else:
        print("none")
    print("# V12_WRONG_TRANSITIONS")
    if v12_transitions:
        for (expected, predicted), count in sorted(v12_transitions.items()):
            print(f"{expected}->{predicted}: {count}")
    else:
        print("none")
    print(f"elapsed_minutes: {elapsed/60.0:.2f}")
    print(f"metrics_file: {metrics_path}")
    print("status: V12_ALL18_RETENTION_COMPARE_COMPLETE")


if __name__ == "__main__":
    main()
