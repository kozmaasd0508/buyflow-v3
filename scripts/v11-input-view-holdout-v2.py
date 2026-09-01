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
from typing import Any, Callable

from v11_fresh_blind_config import MODEL_ID
from v11_fresh_blind_model import file_sha256, infer, load_model, resolve_adapter, strict_prediction
from v11_fresh_blind_score import score
from v11_input_view_holdout_v2_fixture import EXPECTED_SHA256, build_cases, canonical_jsonl
from v11_input_views_v2 import full_prompt, minimal_prompt, semantic_prompt

PromptFn = Callable[[Any, dict[str, Any]], tuple[str, int]]


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _working_run(out_root: Path, fixture_sha: str, adapter_sha: str) -> Path:
    current = out_root / "CURRENT_RUN.txt"
    if current.is_file():
        candidate = Path(current.read_text(encoding="utf-8").strip())
        manifest = candidate / "run-manifest.json"
        if candidate.is_dir() and manifest.is_file():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            if data.get("status") == "RUNNING" and data.get("fixture_sha256") == fixture_sha and data.get("adapter_sha256") == adapter_sha:
                return candidate
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = out_root / "runs" / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "run-manifest.json").write_text(json.dumps({
        "status":"RUNNING","fixture_sha256":fixture_sha,"adapter_sha256":adapter_sha,
        "created_at":datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n", encoding="utf-8")
    current.write_text(str(run_dir) + "\n", encoding="utf-8")
    return run_dir


def _run_view(name: str, prompt_fn: PromptFn, cases: list[dict[str, Any]], tokenizer: Any, model: Any, run_dir: Path) -> list[dict[str, Any]]:
    partial = run_dir / f"{name}.partial.jsonl"
    rows = _read_jsonl(partial)
    by_id = {row["case_id"]: row for row in rows}
    print(f"{name}_resume: {len(by_id)}/{len(cases)}")
    with partial.open("a", encoding="utf-8") as handle:
        for case in cases:
            if case["case_id"] in by_id:
                continue
            prompt, token_count = prompt_fn(tokenizer, case)
            text, latency_ms = infer(tokenizer, model, prompt)
            prediction, error = strict_prediction(text)
            row = {
                "case_id":case["case_id"],"expected":case["expected"],"prediction":prediction,"error":error,
                "latency_ms":round(latency_ms,1),"prompt_tokens":token_count,
            }
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
            by_id[case["case_id"]] = row
            done = len(by_id)
            if done % 10 == 0 or done == len(cases):
                print(f"{name}_progress: {done}/{len(cases)}")
    return [by_id[case["case_id"]] for case in cases]


def _paired(cases: list[dict[str, Any]], left: list[dict[str, Any]], right: list[dict[str, Any]]) -> dict[str, int]:
    left_only = right_only = both_correct = both_wrong = 0
    for case, a, b in zip(cases, left, right):
        a_ok = not a.get("error") and a.get("prediction") == case["expected"]
        b_ok = not b.get("error") and b.get("prediction") == case["expected"]
        if a_ok and b_ok: both_correct += 1
        elif a_ok: left_only += 1
        elif b_ok: right_only += 1
        else: both_wrong += 1
    return {"left_only":left_only,"right_only":right_only,"both_correct":both_correct,"both_wrong":both_wrong,"net_right":right_only-left_only}


def _token_stats(rows: list[dict[str, Any]]) -> dict[str, float | int]:
    vals = [int(row["prompt_tokens"]) for row in rows]
    return {"min":min(vals),"max":max(vals),"mean":sum(vals)/len(vals),"total":sum(vals)}


def main() -> None:
    parser = argparse.ArgumentParser(description="BuyFlow V11 untouched input-view holdout v2")
    parser.add_argument("project_root")
    parser.add_argument("--adapter-dir", default=os.environ.get("BUYFLOW_V11_ADAPTER_DIR"))
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    cases = build_cases()
    raw = canonical_jsonl(cases)
    fixture_sha = hashlib.sha256(raw).hexdigest()
    if fixture_sha != EXPECTED_SHA256:
        raise RuntimeError(f"INPUT_VIEW_HOLDOUT_V2_DRIFT: {fixture_sha} != {EXPECTED_SHA256}")

    out_root = root / "local-data" / "lora-v11" / "input-view-holdout-v2"
    out_root.mkdir(parents=True, exist_ok=True)
    fixture_path = out_root / "fixtures.locked.jsonl"
    fixture_path.write_bytes(raw)
    (out_root / "FIXTURE_SHA256.txt").write_text(fixture_sha + "\n", encoding="utf-8")

    run, adapter, train_metrics = resolve_adapter(root, args.adapter_dir)
    adapter_sha = file_sha256(adapter / "adapter_model.safetensors")
    run_dir = _working_run(out_root, fixture_sha, adapter_sha)

    print("# BUYFLOW V11 INPUT VIEW HOLDOUT V2")
    print(f"cases: {len(cases)}")
    print("views: FULL vs SEMANTIC vs MINIMAL")
    print(f"fixture_sha256: {fixture_sha}")
    print(f"adapter_sha256: {adapter_sha}")
    print("training: False")
    print("fresh_blind_v1_reused: False")
    print("frozen108_read: False")
    print("blind50_read: False")
    print("real_gmail_holdout_read: False")

    import torch
    print(f"gpu_name: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'UNAVAILABLE'}")
    print("loading_model: Qwen3-8B NF4 + V11 adapter")
    tokenizer, model = load_model(adapter)
    started = time.time()

    full_rows = _run_view("full", full_prompt, cases, tokenizer, model, run_dir)
    semantic_rows = _run_view("semantic", semantic_prompt, cases, tokenizer, model, run_dir)
    minimal_rows = _run_view("minimal", minimal_prompt, cases, tokenizer, model, run_dir)

    full_result = score(cases, full_rows)
    semantic_result = score(cases, semantic_rows)
    minimal_result = score(cases, minimal_rows)
    full_semantic = _paired(cases, full_rows, semantic_rows)
    full_minimal = _paired(cases, full_rows, minimal_rows)
    semantic_minimal = _paired(cases, semantic_rows, minimal_rows)

    results = {"full":full_result,"semantic":semantic_result,"minimal":minimal_result}
    safe = [name for name, result in results.items() if result["unsafe_promotion_count"] == 0 and result["other_false_commerce_count"] == 0 and result["incoherent_output_count"] == 0]
    best = max(safe or list(results), key=lambda name: (results[name]["exact_accuracy"], -results[name]["invalid_output_count"], -_token_stats({"full":full_rows,"semantic":semantic_rows,"minimal":minimal_rows}[name])["mean"]))

    combined = run_dir / "predictions.jsonl"
    with combined.open("w", encoding="utf-8") as handle:
        for case, a, b, c in zip(cases, full_rows, semantic_rows, minimal_rows):
            handle.write(json.dumps({"case_id":case["case_id"],"expected":case["expected"],"metadata":case["metadata"],"full":a,"semantic":b,"minimal":c}, ensure_ascii=False, separators=(",", ":")) + "\n")

    metrics = {
        "status":"V11_INPUT_VIEW_HOLDOUT_V2_COMPLETE","fixture_sha256":fixture_sha,"fixture_cases":len(cases),
        "adapter_sha256":adapter_sha,"adapter_dir":str(adapter),"training_run":str(run),"training_best_validation_loss":train_metrics.get("best_validation_loss"),
        "model_id":MODEL_ID,"results":results,"prompt_tokens":{"full":_token_stats(full_rows),"semantic":_token_stats(semantic_rows),"minimal":_token_stats(minimal_rows)},
        "paired":{"full_vs_semantic":full_semantic,"full_vs_minimal":full_minimal,"semantic_vs_minimal":semantic_minimal},
        "recommended_view":best,"elapsed_seconds":time.time()-started,"train_eligible":False,"do_not_train_on_fixture":True,
        "frozen_108_read":False,"blind_50_read":False,"real_gmail_holdout_read":False,
    }
    metrics_path = run_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest_path = run_dir / "run-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({"status":"COMPLETE","completed_at":datetime.now(timezone.utc).isoformat()})
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out_root / "LATEST_EVAL.txt").write_text(str(run_dir) + "\n", encoding="utf-8")
    current = out_root / "CURRENT_RUN.txt"
    if current.exists(): current.unlink()

    print("\n# RESULT")
    for name in ("full","semantic","minimal"):
        r = results[name]
        t = metrics["prompt_tokens"][name]
        print(f"{name.upper()} exact: {r['exact_correct']}/{r['total']} ({100*r['exact_accuracy']:.2f}%) | invalid={r['invalid_output_count']} unsafe={r['unsafe_promotion_count']} critical={r['critical_boundary_error_count']} | mean_tokens={t['mean']:.1f}")
    print(f"FULL->SEMANTIC net: {full_semantic['net_right']:+d}")
    print(f"FULL->MINIMAL net: {full_minimal['net_right']:+d}")
    print(f"SEMANTIC->MINIMAL net: {semantic_minimal['net_right']:+d}")
    print(f"recommended_view: {best}")
    print(f"metrics_file: {metrics_path}")
    print("status: V11_INPUT_VIEW_HOLDOUT_V2_COMPLETE")

    del model
    gc.collect()
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
