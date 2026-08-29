#!/usr/bin/env bash
set -euo pipefail

VENV="$HOME/.venvs/buyflow-lora"
PYTHON="$VENV/bin/python"

export HSA_ENABLE_DXG_DETECTION=1
export TOKENIZERS_PARALLELISM=false
export HF_HOME="${HF_HOME:-$HOME/.cache/huggingface}"

if [[ ! -x "$PYTHON" ]]; then
  echo "BUYFLOW_V9_ENV_ERROR: missing $PYTHON" >&2
  exit 2
fi

"$PYTHON" - <<'PY'
import sys
import torch
import transformers
import peft

print(f"python: {sys.executable}")
print(f"torch: {torch.__version__}")
print(f"torch_hip: {torch.version.hip}")
print(f"gpu_available: {torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("BUYFLOW_V9_ENV_ERROR: ROCm GPU unavailable")
print(f"gpu_name: {torch.cuda.get_device_name(0)}")
print(f"transformers: {transformers.__version__}")
print(f"peft: {peft.__version__}")
print("status: BUYFLOW_V9_WSL_ENV_READY")
PY
