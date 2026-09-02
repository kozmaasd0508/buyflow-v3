from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

EXPECTED_TRAIN_METRICS_STATUS = "LORA_V12_RETENTION_ROBUSTNESS_TRAIN_COMPLETE"
EXPECTED_PARENT_V11_SHA = "462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b"
PARENT_V11_RUN = "20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic"


def _load_base() -> Any:
    here = Path(__file__).resolve().parent
    base_path = here / "v12-hard-siblings-posttrain-v1.py"
    spec = importlib.util.spec_from_file_location("v12_hard_siblings_posttrain_base", base_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"V12_POSTTRAIN_BASE_IMPORT_FAILED:{base_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    base = _load_base()

    def _resolved_v12_adapter(root: Path, explicit: str | None):
        if explicit:
            adapter = Path(explicit).expanduser().resolve()
            run = adapter.parent
            source = "EXPLICIT"
        else:
            latest_path = root / "local-data" / "lora-v12" / "LATEST.txt"
            if not latest_path.is_file():
                raise RuntimeError(f"V12_LATEST_POINTER_MISSING:{latest_path}")
            raw = latest_path.read_text(encoding="utf-8").strip()
            if not raw:
                raise RuntimeError(f"V12_LATEST_POINTER_EMPTY:{latest_path}")
            run = Path(raw).expanduser()
            if not run.is_absolute():
                run = (root / run).resolve()
            adapter = run / "best"
            source = "LATEST_POINTER"

        metrics_path = run / "metrics.json"
        weights = adapter / "adapter_model.safetensors"
        if not metrics_path.is_file():
            raise RuntimeError(f"V12_METRICS_MISSING:{metrics_path}")
        if not weights.is_file():
            raise RuntimeError(f"V12_ADAPTER_WEIGHTS_MISSING:{weights}")

        metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        if metrics.get("status") != EXPECTED_TRAIN_METRICS_STATUS:
            raise RuntimeError(
                f"V12_TRAIN_METRICS_STATUS:{metrics.get('status')}!={EXPECTED_TRAIN_METRICS_STATUS}"
            )

        adapter_sha = base.file_sha256(weights)
        if adapter_sha != base.EXPECTED_V12_ADAPTER_SHA:
            raise RuntimeError(f"V12_ADAPTER_SHA_MISMATCH:{adapter_sha}")
        if metrics.get("best_adapter_sha256") != base.EXPECTED_V12_ADAPTER_SHA:
            raise RuntimeError(
                f"V12_METRICS_ADAPTER_SHA:{metrics.get('best_adapter_sha256')}!={base.EXPECTED_V12_ADAPTER_SHA}"
            )
        if metrics.get("parent_adapter_sha256") != EXPECTED_PARENT_V11_SHA:
            raise RuntimeError(
                f"V12_PARENT_SHA_IN_METRICS:{metrics.get('parent_adapter_sha256')}!={EXPECTED_PARENT_V11_SHA}"
            )

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
                raise RuntimeError(f"V12_POSTTRAIN_SAFETY_GATE:{key}:{metrics.get(key)}")
        if metrics.get("all_18_events_retained") is not True:
            raise RuntimeError("V12_POSTTRAIN_18_EVENT_RETENTION_GATE")

        parent_weights = (
            root
            / "local-data"
            / "lora-v11"
            / "runs"
            / PARENT_V11_RUN
            / "best"
            / "adapter_model.safetensors"
        )
        if not parent_weights.is_file():
            raise RuntimeError(f"V11_PARENT_WEIGHTS_MISSING:{parent_weights}")
        current_parent_sha = base.file_sha256(parent_weights)
        if current_parent_sha != EXPECTED_PARENT_V11_SHA:
            raise RuntimeError(f"V11_PARENT_CHANGED:{current_parent_sha}")

        # The original evaluator expects this convenience gate. The trainer did
        # not persist that exact boolean, so derive it here from the exact current
        # parent SHA plus the parent SHA recorded in V12 metrics.
        metrics = dict(metrics)
        metrics["parent_v11_unchanged"] = True

        print(f"v12_adapter_resolution: {source}", flush=True)
        print(f"v12_training_run: {run}", flush=True)
        print(f"v12_metrics_status: {metrics.get('status')}", flush=True)
        print(f"v12_adapter_sha256_verified: {adapter_sha}", flush=True)
        print(f"parent_v11_sha256_verified: {current_parent_sha}", flush=True)
        return run, adapter, metrics

    base._resolve_v12_adapter = _resolved_v12_adapter
    base.main()


if __name__ == "__main__":
    main()
