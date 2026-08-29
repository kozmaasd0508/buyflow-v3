#!/usr/bin/env python3
"""Launch the existing BuyFlow V9 safe shadow server from an explicit local run.

This is a local-launch compatibility wrapper. It preserves the V9 server's safety
checks but does not depend on local-data/lora-v7/LATEST.txt living beside the
server source. The selected run still must prove the recorded V9 training status,
locked-test isolation, and a complete best adapter directory.

The wrapper may initially be invoked by WSL's system python. If that interpreter
is not running inside the isolated BuyFlow LoRA venv, it re-execs itself with the
exact runtime used by training: ~/.venvs/buyflow-lora/bin/python.
"""
import json
import os
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

EXPECTED_STATUS = "LORA_V9_TEACHER_DIALOGUE_CORRECTION_TRAIN_COMPLETE"
VENV_ROOT = Path.home() / ".venvs" / "buyflow-lora"
VENV_PYTHON = VENV_ROOT / "bin" / "python"


def ensure_lora_runtime():
    os.environ.setdefault("HSA_ENABLE_DXG_DETECTION", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HOME", str(Path.home() / ".cache" / "huggingface"))

    if not VENV_PYTHON.is_file():
        raise RuntimeError(
            f"BuyFlow LoRA venv missing: {VENV_PYTHON}. "
            "Refusing to install or alter the training environment automatically."
        )

    # Do NOT compare resolved python executables here: venv/bin/python is usually
    # a symlink to the system binary, so both resolve to the same file even though
    # only one interpreter has the venv site-packages active. sys.prefix is the
    # reliable signal that the venv itself is active.
    active_prefix = Path(sys.prefix).resolve()
    expected_prefix = VENV_ROOT.resolve()
    if active_prefix != expected_prefix:
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])


def load_module(script: Path):
    spec = spec_from_file_location("buyflow_v9_explicit_server", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load V9 server: {script}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: lora-v9-explicit-run-server.py <v9-server-script> <v9-run-dir>")

    ensure_lora_runtime()

    # Prove the active runtime is the trained GPU stack before loading model code.
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("BuyFlow LoRA runtime loaded, but ROCm GPU is unavailable")

    server_script = Path(sys.argv[1]).resolve()
    run_dir = Path(sys.argv[2]).resolve()
    if not server_script.is_file():
        raise RuntimeError(f"Missing V9 server script: {server_script}")
    metrics_file = run_dir / "metrics.json"
    best_dir = run_dir / "best"
    adapter_weights = best_dir / "adapter_model.safetensors"
    adapter_config = best_dir / "adapter_config.json"
    if not metrics_file.is_file():
        raise RuntimeError(f"V9 metrics missing: {metrics_file}")
    if not adapter_weights.is_file() or not adapter_config.is_file():
        raise RuntimeError(f"V9 best adapter incomplete: {best_dir}")

    metrics = json.loads(metrics_file.read_text(encoding="utf-8"))
    if metrics.get("status") != EXPECTED_STATUS:
        raise RuntimeError(f"Unexpected V9 training status: {metrics.get('status')}")
    if metrics.get("locked_test_read") is not False or metrics.get("locked_test_trained") is not False:
        raise RuntimeError("V9 metrics do not prove locked-test isolation")
    recorded_best = metrics.get("best_adapter_dir")
    if recorded_best and Path(recorded_best).resolve() != best_dir:
        raise RuntimeError("V9 best adapter path mismatch")

    print(f"runtime_python: {sys.executable}")
    print(f"runtime_prefix: {sys.prefix}")
    print(f"runtime_torch: {torch.__version__}")
    print(f"runtime_hip: {torch.version.hip}")
    print(f"runtime_gpu: {torch.cuda.get_device_name(0)}")
    sys.stdout.flush()

    v9 = load_module(server_script)

    def explicit_loader(_repo_root: Path):
        return run_dir, best_dir, metrics

    # V9's BASE is the inherited safe V6 server module. load_model resolves this
    # hook at runtime, so replacing it keeps the proven model-loading path while
    # supplying an explicit audited run directory.
    v9.BASE.load_latest_v4 = explicit_loader

    # V9.main only uses its repo-root argument as input to BASE.load_model. The
    # explicit loader above intentionally ignores it.
    sys.argv = [str(server_script), str(server_script.parent.parent)]
    v9.main()


if __name__ == "__main__":
    main()
