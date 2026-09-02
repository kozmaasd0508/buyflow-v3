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

from v11_fresh_blind_config import ALLOWED
from v11_fresh_blind_model import file_sha256, load_model, prompt_for_case, strict_prediction
from v12_constrained_output import infer_constrained

EXPECTED_HOLDOUT_SHA = "03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba"
EXPECTED_ROWS = 108
EXPECTED_PER_EVENT = 6
EXPECTED_V11_ADAPTER_SHA = "462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b"
EXPECTED_V12_ADAPTER_SHA = "5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630"
EXPECTED_V12_STATUS = "LORA_V12_RETENTION_ROBUSTNESS_TRAIN_COMPLETE"
PARENT_RUN_NAME = "20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic"
LANGUAGES = ("hu", "en", "de", "pl", "fr", "es")
VARIANTS = ("clean_plain", "stale_subject", "html_only", "stale_snippet", "quoted_history", "metadata_noise")


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
                row = json.loads(line)
                if not isinstance(row, dict):
                    raise RuntimeError("HOLDOUT_ROW_NOT_OBJECT")
                rows.append(row)
    return rows


def validate_holdout(root: Path) -> tuple[Path, list[dict[str, Any]], dict[str, Any]]:
    holdout = root / "local-data" / "lora-v12" / "posttrain-holdout-v1"
    cases_path = holdout / "cases.jsonl"
    sha_path = holdout / "HOLDOUT_SHA256.txt"
    manifest_path = holdout / "manifest.json"
    for required in (cases_path, sha_path, manifest_path):
        if not required.is_file():
            raise RuntimeError(f"HOLDOUT_FILE_MISSING:{required}")

    actual_sha = sha256_file(cases_path)
    recorded_sha = sha_path.read_text(encoding="utf-8").strip()
    if actual_sha != EXPECTED_HOLDOUT_SHA or recorded_sha != EXPECTED_HOLDOUT_SHA:
        raise RuntimeError(f"HOLDOUT_SHA_MISMATCH:{actual_sha}:{recorded_sha}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("status") != "V12_POSTTRAIN_HOLDOUT_V1_FROZEN":
        raise RuntimeError(f"HOLDOUT_STATUS:{manifest.get('status')}")
    if manifest.get("holdout_sha256") != EXPECTED_HOLDOUT_SHA:
        raise RuntimeError(f"HOLDOUT_MANIFEST_SHA:{manifest.get('holdout_sha256')}")
    for key in ("training_eligible", "tuning_eligible", "model_loaded", "v11_scored", "v12_scored"):
        if manifest.get(key) is not False:
            raise RuntimeError(f"HOLDOUT_FREEZE_GATE:{key}")
    for key in (
        "fresh_blind_read",
        "input_view_holdout_read",
        "frozen108_read",
        "blind50_read",
        "prior_training_corpus_read",
        "prior_hard_sibling_rows_read",
    ):
        if manifest.get(key) is not False:
            raise RuntimeError(f"HOLDOUT_ISOLATION_GATE:{key}")

    rows = read_jsonl(cases_path)
    if len(rows) != EXPECTED_ROWS:
        raise RuntimeError(f"HOLDOUT_ROW_COUNT:{len(rows)}!={EXPECTED_ROWS}")
    ids = [str(row.get("case_id")) for row in rows]
    if len(set(ids)) != len(ids):
        raise RuntimeError("HOLDOUT_DUPLICATE_CASE_ID")
    if any(row.get("split") != "UNTOUCHED_HOLDOUT" for row in rows):
        raise RuntimeError("HOLDOUT_SPLIT_MISMATCH")
    if any(row.get("metadata", {}).get("train_eligible") is not False for row in rows):
        raise RuntimeError("HOLDOUT_TRAIN_ELIGIBLE_ROW")
    if any(row.get("metadata", {}).get("tuning_eligible") is not False for row in rows):
        raise RuntimeError("HOLDOUT_TUNING_ELIGIBLE_ROW")

    event_counts = Counter(row["expected"]["event_type"] for row in rows)
    language_counts = Counter(row["metadata"]["language"] for row in rows)
    variant_counts = Counter(row["metadata"]["representation_variant"] for row in rows)
    event_language = Counter((row["expected"]["event_type"], row["metadata"]["language"]) for row in rows)
    event_variant = Counter((row["expected"]["event_type"], row["metadata"]["representation_variant"]) for row in rows)

    if set(event_counts) != set(ALLOWED) or any(event_counts[event] != EXPECTED_PER_EVENT for event in ALLOWED):
        raise RuntimeError(f"HOLDOUT_EVENT_DISTRIBUTION:{dict(event_counts)}")
    if set(language_counts) != set(LANGUAGES) or any(language_counts[lang] != 18 for lang in LANGUAGES):
        raise RuntimeError(f"HOLDOUT_LANGUAGE_DISTRIBUTION:{dict(language_counts)}")
    if set(variant_counts) != set(VARIANTS) or any(variant_counts[v] != 18 for v in VARIANTS):
        raise RuntimeError(f"HOLDOUT_VARIANT_DISTRIBUTION:{dict(variant_counts)}")
    if any(event_language[(event, lang)] != 1 for event in ALLOWED for lang in LANGUAGES):
        raise RuntimeError("HOLDOUT_EVENT_LANGUAGE_MATRIX")
    if any(event_variant[(event, variant)] != 1 for event in ALLOWED for variant in VARIANTS):
        raise RuntimeError("HOLDOUT_EVENT_VARIANT_MATRIX")

    return holdout, rows, manifest


def resolve_v11(root: Path) -> tuple[Path, Path]:
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
    return run, adapter


def resolve_v12(root: Path) -> tuple[Path, Path]:
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
        raise RuntimeError(f"V12_RECORDED_SHA:{metrics.get('best_adapter_sha256')}")
    if metrics.get("parent_adapter_sha256") != EXPECTED_V11_ADAPTER_SHA:
        raise RuntimeError(f"V12_PARENT_SHA:{metrics.get('parent_adapter_sha256')}")
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
    return run, adapter


def score_model(name: str, adapter: Path, rows: list[dict[str, Any]], out_file: Path) -> list[dict[str, Any]]:
    print(f"loading_{name.lower()}: Qwen3-8B NF4 + {name} adapter + constrained output", flush=True)
    tokenizer, model = load_model(adapter)
    scored: list[dict[str, Any]] = []
    try:
        with out_file.open("w", encoding="utf-8") as handle:
            for index, case in enumerate(rows, 1):
                prompt, prompt_tokens = prompt_for_case(tokenizer, case)
                text, latency_ms = infer_constrained(tokenizer, model, prompt)
                prediction, error = strict_prediction(text)
                expected = case["expected"]
                item = {
                    "model": name,
                    "case_id": case["case_id"],
                    "expected": expected,
                    "prediction": prediction,
                    "invalid_error": error,
                    "exact": error is None and prediction == expected,
                    "event_type": expected["event_type"],
                    "language": case["metadata"]["language"],
                    "representation_variant": case["metadata"]["representation_variant"],
                    "prompt_tokens": prompt_tokens,
                    "latency_ms": round(latency_ms, 1),
                }
                scored.append(item)
                handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
                if index % 18 == 0 or index == len(rows):
                    print(f"{name.lower()}_progress: {index}/{len(rows)}", flush=True)
    finally:
        del model
        gc.collect()
        import torch
        torch.cuda.empty_cache()
    return scored


def summarize(rows: list[dict[str, Any]], key: str) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "exact": 0, "invalid": 0})
    for row in rows:
        value = str(row[key])
        out[value]["total"] += 1
        if row["exact"]:
            out[value]["exact"] += 1
        if row["invalid_error"] is not None:
            out[value]["invalid"] += 1
    return dict(out)


def wrong_transitions(rows: list[dict[str, Any]]) -> Counter[tuple[str, str]]:
    transitions: Counter[tuple[str, str]] = Counter()
    for row in rows:
        if row["exact"] or row["prediction"] is None:
            continue
        transitions[(row["expected"]["event_type"], row["prediction"]["event_type"])] += 1
    return transitions


def main() -> None:
    if len(os.sys.argv) != 2:
        raise SystemExit("Usage: v12-posttrain-holdout-compare-v1.py <project-root>")
    root = Path(os.sys.argv[1]).resolve()
    holdout, rows, _manifest = validate_holdout(root)
    v11_run, v11_adapter = resolve_v11(root)
    v12_run, v12_adapter = resolve_v12(root)

    compare_root = holdout / "one-shot-compare"
    final_marker = compare_root / "FINAL_RESULT.json"
    if final_marker.exists():
        raise RuntimeError(f"HOLDOUT_ALREADY_SCORED:{final_marker}")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = compare_root / "runs" / stamp
    out.mkdir(parents=True, exist_ok=False)

    print("# BUYFLOW V12 POSTTRAIN UNTOUCHED HOLDOUT - ONE SHOT COMPARE")
    print(f"holdout_sha256: {EXPECTED_HOLDOUT_SHA}")
    print(f"rows: {len(rows)}")
    print("events: 18")
    print("rows_per_event: 6")
    print("languages: hu,en,de,pl,fr,es")
    print("variants: clean_plain,stale_subject,html_only,stale_snippet,quoted_history,metadata_noise")
    print("training: False")
    print("corpus_mutation: False")
    print("protected_holdouts_read: False")
    print(f"v11_adapter_sha256: {EXPECTED_V11_ADAPTER_SHA}")
    print(f"v12_adapter_sha256: {EXPECTED_V12_ADAPTER_SHA}")
    print(f"v11_run: {v11_run}")
    print(f"v12_run: {v12_run}")
    print("per_case_results_hidden_until_both_models_complete: True")

    started = time.time()
    v11_rows = score_model("V11", v11_adapter, rows, out / "v11.predictions.jsonl")
    v12_rows = score_model("V12", v12_adapter, rows, out / "v12.predictions.jsonl")
    elapsed = time.time() - started

    v11_exact = sum(1 for row in v11_rows if row["exact"])
    v12_exact = sum(1 for row in v12_rows if row["exact"])
    v11_invalid = sum(1 for row in v11_rows if row["invalid_error"] is not None)
    v12_invalid = sum(1 for row in v12_rows if row["invalid_error"] is not None)

    v11_by_event = summarize(v11_rows, "event_type")
    v12_by_event = summarize(v12_rows, "event_type")
    v11_by_language = summarize(v11_rows, "language")
    v12_by_language = summarize(v12_rows, "language")
    v11_by_variant = summarize(v11_rows, "representation_variant")
    v12_by_variant = summarize(v12_rows, "representation_variant")
    v11_transitions = wrong_transitions(v11_rows)
    v12_transitions = wrong_transitions(v12_rows)

    v11_map = {row["case_id"]: row for row in v11_rows}
    v12_map = {row["case_id"]: row for row in v12_rows}
    both_right = v12_wins = v11_wins = both_wrong = changed_predictions = 0
    for case_id in v11_map:
        a = v11_map[case_id]
        b = v12_map[case_id]
        if a["exact"] and b["exact"]:
            both_right += 1
        elif not a["exact"] and b["exact"]:
            v12_wins += 1
        elif a["exact"] and not b["exact"]:
            v11_wins += 1
        else:
            both_wrong += 1
        if a["prediction"] != b["prediction"] or a["invalid_error"] != b["invalid_error"]:
            changed_predictions += 1

    event_compare = {
        event: {
            "total": EXPECTED_PER_EVENT,
            "v11_exact": v11_by_event[event]["exact"],
            "v12_exact": v12_by_event[event]["exact"],
            "delta": v12_by_event[event]["exact"] - v11_by_event[event]["exact"],
        }
        for event in sorted(ALLOWED)
    }
    language_compare = {
        lang: {
            "total": 18,
            "v11_exact": v11_by_language[lang]["exact"],
            "v12_exact": v12_by_language[lang]["exact"],
            "delta": v12_by_language[lang]["exact"] - v11_by_language[lang]["exact"],
        }
        for lang in LANGUAGES
    }
    variant_compare = {
        variant: {
            "total": 18,
            "v11_exact": v11_by_variant[variant]["exact"],
            "v12_exact": v12_by_variant[variant]["exact"],
            "delta": v12_by_variant[variant]["exact"] - v11_by_variant[variant]["exact"],
        }
        for variant in VARIANTS
    }

    result = {
        "status": "V12_POSTTRAIN_UNTOUCHED_HOLDOUT_V1_ONE_SHOT_COMPLETE",
        "holdout_sha256": EXPECTED_HOLDOUT_SHA,
        "rows": len(rows),
        "training": False,
        "corpus_mutation": False,
        "protected_holdouts_read": False,
        "v11_adapter_sha256": EXPECTED_V11_ADAPTER_SHA,
        "v12_adapter_sha256": EXPECTED_V12_ADAPTER_SHA,
        "v11_exact": v11_exact,
        "v12_exact": v12_exact,
        "delta_exact": v12_exact - v11_exact,
        "v11_invalid": v11_invalid,
        "v12_invalid": v12_invalid,
        "both_right": both_right,
        "v12_wins": v12_wins,
        "v11_wins": v11_wins,
        "both_wrong": both_wrong,
        "changed_predictions": changed_predictions,
        "event_compare": event_compare,
        "language_compare": language_compare,
        "variant_compare": variant_compare,
        "v11_wrong_transitions": {f"{a}->{b}": n for (a, b), n in sorted(v11_transitions.items())},
        "v12_wrong_transitions": {f"{a}->{b}": n for (a, b), n in sorted(v12_transitions.items())},
        "elapsed_minutes": elapsed / 60.0,
        "run_dir": str(out),
    }
    metrics_path = out / "metrics.json"
    metrics_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    compare_root.mkdir(parents=True, exist_ok=True)
    final_marker.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    print(f"V11: {v11_exact}/{len(rows)} ({100.0*v11_exact/len(rows):.2f}%)")
    print(f"V12: {v12_exact}/{len(rows)} ({100.0*v12_exact/len(rows):.2f}%)")
    print(f"delta_exact: {v12_exact-v11_exact:+d}")
    print(f"invalid_v11: {v11_invalid}")
    print(f"invalid_v12: {v12_invalid}")
    print(f"both_right: {both_right}")
    print(f"v12_wins: {v12_wins}")
    print(f"v11_wins: {v11_wins}")
    print(f"both_wrong: {both_wrong}")
    print(f"changed_predictions: {changed_predictions}")

    print("# BY_EVENT")
    for event in sorted(ALLOWED):
        info = event_compare[event]
        print(f"{event}: V11={info['v11_exact']}/{info['total']} V12={info['v12_exact']}/{info['total']} delta={info['delta']:+d}")

    print("# BY_LANGUAGE")
    for lang in LANGUAGES:
        info = language_compare[lang]
        print(f"{lang}: V11={info['v11_exact']}/{info['total']} V12={info['v12_exact']}/{info['total']} delta={info['delta']:+d}")

    print("# BY_VARIANT")
    for variant in VARIANTS:
        info = variant_compare[variant]
        print(f"{variant}: V11={info['v11_exact']}/{info['total']} V12={info['v12_exact']}/{info['total']} delta={info['delta']:+d}")

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
    print(f"final_result_file: {final_marker}")
    print("status: V12_POSTTRAIN_UNTOUCHED_HOLDOUT_V1_ONE_SHOT_COMPLETE")


if __name__ == "__main__":
    main()
