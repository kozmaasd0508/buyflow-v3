#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
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


def _payload_with_group(document: dict[str, Any], group: str) -> dict[str, Any]:
    payload = build_semantic_email_view(document)
    if group in {"raw_html", "all"}:
        payload["bodyHtmlRaw"] = document.get("bodyHtml")
    if group in {"recipients", "all"}:
        payload["to"] = document.get("to")
        payload["cc"] = document.get("cc")
        payload["bcc"] = document.get("bcc")
    if group in {"headers_auth", "all"}:
        payload["headers"] = document.get("headers")
        payload["authentication"] = document.get("authentication")
    if group in {"provider_meta", "all"}:
        payload["provider"] = document.get("provider")
        payload["providerMessageId"] = document.get("providerMessageId")
        payload["providerThreadId"] = document.get("providerThreadId")
        payload["folders"] = document.get("folders")
    if group in {"raw_links", "all"}:
        payload["rawLinks"] = document.get("links")
    if group in {"raw_attachments", "all"}:
        payload["rawAttachments"] = document.get("attachments")
    if group in {"pipeline_meta", "all"}:
        payload["rawRef"] = document.get("rawRef")
        payload["normalizerVersion"] = document.get("normalizerVersion")
        payload["traceId"] = document.get("traceId")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="V11 semantic-view add-back diagnostic")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    if __import__("hashlib").sha256(canonical_jsonl(cases)).hexdigest() != EXPECTED_SHA256:
        raise RuntimeError("HOLDOUT_V2_FIXTURE_DRIFT")

    run_dir, combined = _load_latest_holdout(root)
    by_id = {row["case_id"]: row for row in combined}
    case_by_id = {case["case_id"]: case for case in cases}

    candidates: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for case in cases:
        row = by_id[case["case_id"]]
        expected = case["expected"]
        if _is_exact(row["full"], expected) and not _is_exact(row["semantic"], expected):
            candidates.append((case, row))

    print("# V11 INPUT VIEW ADD-BACK V1")
    print(f"source_run: {run_dir}")
    print(f"full_correct_semantic_wrong_cases: {len(candidates)}")
    print("diagnostic_only: True")
    print("training: False")
    if not candidates:
        print("status: NOTHING_TO_TEST")
        return

    _, adapter, _ = resolve_adapter(root, args.adapter_dir)
    tokenizer, model = load_model(adapter)

    groups = [
        "raw_html",
        "recipients",
        "headers_auth",
        "provider_meta",
        "raw_links",
        "raw_attachments",
        "pipeline_meta",
        "all",
    ]
    recovered = {group: 0 for group in groups}
    added_tokens = {group: [] for group in groups}
    report: list[dict[str, Any]] = []

    for case, row in candidates:
        semantic_tokens = int(row["semantic"]["prompt_tokens"])
        item: dict[str, Any] = {
            "case_id": case["case_id"],
            "expected": case["expected"],
            "metadata": case["metadata"],
            "full": row["full"],
            "semantic": row["semantic"],
            "tests": {},
        }
        print(f"case: {case['case_id']} expected={case['expected']['event_type']} semantic={row['semantic'].get('prediction')}")
        for group in groups:
            payload = _payload_with_group(case["document"], group)
            prompt, token_count = _prompt_for_payload(tokenizer, case["case_id"], payload)
            text, latency_ms = infer(tokenizer, model, prompt)
            prediction, error = strict_prediction(text)
            exact = error is None and prediction == case["expected"]
            if exact:
                recovered[group] += 1
            added_tokens[group].append(token_count - semantic_tokens)
            item["tests"][group] = {
                "prediction": prediction,
                "error": error,
                "exact": exact,
                "prompt_tokens": token_count,
                "added_tokens_vs_semantic": token_count - semantic_tokens,
                "latency_ms": round(latency_ms, 1),
            }
            print(f"  {group}: exact={exact} tokens={token_count} pred={prediction} error={error}")
        report.append(item)

    summary = {
        "status": "V11_INPUT_VIEW_ADDBACK_V1_COMPLETE",
        "source_run": str(run_dir),
        "fixture_sha256": EXPECTED_SHA256,
        "candidate_count": len(candidates),
        "recovered": recovered,
        "mean_added_tokens_vs_semantic": {
            group: (sum(values) / len(values) if values else 0.0)
            for group, values in added_tokens.items()
        },
        "diagnostic_only": True,
        "train_eligible": False,
        "do_not_train_on_fixture": True,
        "cases": report,
    }
    out = run_dir / "input-view-addback-v1.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    for group in groups:
        print(f"{group}: recovered={recovered[group]}/{len(candidates)} mean_added_tokens={summary['mean_added_tokens_vs_semantic'][group]:.1f}")
    print(f"report_file: {out}")
    print("status: V11_INPUT_VIEW_ADDBACK_V1_COMPLETE")

    del model
    gc.collect()
    import torch
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
