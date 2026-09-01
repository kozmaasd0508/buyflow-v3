#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import gc
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from v11_fresh_blind_model import infer, load_model, resolve_adapter, strict_prediction
from v11_input_view_holdout_v2_fixture import EXPECTED_SHA256, build_cases, canonical_jsonl
from v11_input_views_v2 import _prompt_for_payload
from v11_semantic_view_v1 import build_semantic_email_view


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _is_exact(row: dict[str, Any], expected: dict[str, Any]) -> bool:
    return not row.get("error") and row.get("prediction") == expected


def _load_latest_holdout(root: Path) -> tuple[Path, list[dict[str, Any]]]:
    out_root = root / "local-data" / "lora-v11" / "input-view-holdout-v2"
    latest = out_root / "LATEST_EVAL.txt"
    if not latest.is_file():
        raise RuntimeError(f"HOLDOUT_V2_LATEST_MISSING: {latest}")
    run_dir = Path(latest.read_text(encoding="utf-8").strip())
    metrics = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))
    if metrics.get("status") != "V11_INPUT_VIEW_HOLDOUT_V2_COMPLETE":
        raise RuntimeError("HOLDOUT_V2_NOT_COMPLETE")
    if metrics.get("fixture_sha256") != EXPECTED_SHA256:
        raise RuntimeError("HOLDOUT_V2_FIXTURE_MISMATCH")
    return run_dir, _read_jsonl(run_dir / "predictions.jsonl")


def _real_variant(document: dict[str, Any], group: str) -> dict[str, Any]:
    payload = build_semantic_email_view(document)
    if group == "recipients":
        payload["to"] = document.get("to")
        payload["cc"] = document.get("cc")
        payload["bcc"] = document.get("bcc")
    elif group == "headers_auth":
        payload["headers"] = document.get("headers")
        payload["authentication"] = document.get("authentication")
    elif group == "raw_links":
        payload["rawLinks"] = document.get("links")
    else:
        raise ValueError(group)
    return payload


def _dummy_variant(document: dict[str, Any], group: str) -> dict[str, Any]:
    payload = build_semantic_email_view(document)
    if group == "recipients":
        to_count = len(document.get("to") or [])
        cc_count = len(document.get("cc") or [])
        bcc_count = len(document.get("bcc") or [])
        payload["to"] = [{"email": f"neutral{i}@example.invalid", "name": "Neutral"} for i in range(to_count)]
        payload["cc"] = [{"email": f"neutralcc{i}@example.invalid", "name": "Neutral"} for i in range(cc_count)]
        payload["bcc"] = [{"email": f"neutralbcc{i}@example.invalid", "name": "Neutral"} for i in range(bcc_count)]
    elif group == "headers_auth":
        raw_headers = document.get("headers") or []
        payload["headers"] = [
            {"name": f"X-Neutral-{i}", "value": "neutral metadata only"}
            for i, _ in enumerate(raw_headers)
        ]
        auth = document.get("authentication") or {}
        payload["authentication"] = {key: "neutral" for key in auth.keys()} if isinstance(auth, dict) else {}
    elif group == "raw_links":
        raw_links = document.get("links") or []
        payload["rawLinks"] = [
            {"href": f"https://neutral.invalid/item/{i}", "text": "Neutral link", "rel": ["neutral"], "source": "neutral"}
            for i, _ in enumerate(raw_links)
        ]
    else:
        raise ValueError(group)
    return payload


def _neutral_padding_to_target(tokenizer: Any, case_id: str, base: dict[str, Any], target_tokens: int) -> tuple[dict[str, Any], int]:
    payload = copy.deepcopy(base)
    payload["neutralPadding"] = ""
    prompt, count = _prompt_for_payload(tokenizer, case_id, payload)
    if count >= target_tokens:
        return payload, count
    words = []
    for _ in range(256):
        words.append("neutral")
        payload["neutralPadding"] = " ".join(words)
        prompt, count = _prompt_for_payload(tokenizer, case_id, payload)
        if count >= target_tokens:
            return payload, count
    raise RuntimeError(f"NEUTRAL_PADDING_TARGET_UNREACHABLE: {count} < {target_tokens}")


def main() -> None:
    parser = argparse.ArgumentParser(description="V11 input-view causality diagnostic")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    fixture_sha = hashlib.sha256(canonical_jsonl(cases)).hexdigest()
    if fixture_sha != EXPECTED_SHA256:
        raise RuntimeError("HOLDOUT_V2_FIXTURE_DRIFT")

    run_dir, combined = _load_latest_holdout(root)
    by_id = {row["case_id"]: row for row in combined}
    candidates: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for case in cases:
        row = by_id[case["case_id"]]
        expected = case["expected"]
        if _is_exact(row["full"], expected) and not _is_exact(row["semantic"], expected):
            candidates.append((case, row))

    print("# V11 INPUT VIEW CAUSALITY V1")
    print(f"source_run: {run_dir}")
    print(f"candidate_count: {len(candidates)}")
    print("question: useful evidence vs prompt-shape/token-position sensitivity")
    print("diagnostic_only: True")
    print("training: False")
    if not candidates:
        print("status: NOTHING_TO_TEST")
        return

    _, adapter, _ = resolve_adapter(root, args.adapter_dir)
    tokenizer, model = load_model(adapter)
    groups = ["recipients", "headers_auth", "raw_links"]
    report: list[dict[str, Any]] = []

    for case, row in candidates:
        base = build_semantic_email_view(case["document"])
        item: dict[str, Any] = {
            "case_id": case["case_id"],
            "expected": case["expected"],
            "semantic_original": row["semantic"],
            "tests": {},
        }
        print(f"case: {case['case_id']} expected={case['expected']['event_type']} semantic={row['semantic'].get('prediction')}")

        variants: list[tuple[str, dict[str, Any]]] = [("semantic_recheck", base)]
        for group in groups:
            real_payload = _real_variant(case["document"], group)
            _, real_tokens = _prompt_for_payload(tokenizer, case["case_id"], real_payload)
            dummy_payload = _dummy_variant(case["document"], group)
            neutral_payload, neutral_tokens = _neutral_padding_to_target(tokenizer, case["case_id"], base, real_tokens)
            variants.extend([
                (f"real_{group}", real_payload),
                (f"dummy_{group}", dummy_payload),
                (f"neutral_pad_like_{group}", neutral_payload),
            ])
            print(f"  target_tokens_{group}: real={real_tokens} neutral={neutral_tokens}")

        for name, payload in variants:
            prompt, token_count = _prompt_for_payload(tokenizer, case["case_id"], payload)
            text, latency_ms = infer(tokenizer, model, prompt)
            prediction, error = strict_prediction(text)
            exact = error is None and prediction == case["expected"]
            item["tests"][name] = {
                "prediction": prediction,
                "error": error,
                "exact": exact,
                "prompt_tokens": token_count,
                "latency_ms": round(latency_ms, 1),
            }
            print(f"  {name}: exact={exact} tokens={token_count} pred={prediction} error={error}")
        report.append(item)

    summary: dict[str, Any] = {
        "status": "V11_INPUT_VIEW_CAUSALITY_V1_COMPLETE",
        "source_run": str(run_dir),
        "fixture_sha256": EXPECTED_SHA256,
        "candidate_count": len(candidates),
        "diagnostic_only": True,
        "train_eligible": False,
        "do_not_train_on_fixture": True,
        "cases": report,
    }
    out = run_dir / "input-view-causality-v1.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    names = list(report[0]["tests"].keys())
    for name in names:
        recovered = sum(1 for item in report if item["tests"][name]["exact"])
        print(f"{name}: recovered={recovered}/{len(report)}")
    print(f"report_file: {out}")
    print("status: V11_INPUT_VIEW_CAUSALITY_V1_COMPLETE")

    del model
    gc.collect()
    import torch
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
