$ErrorActionPreference = 'Stop'

Write-Host '=============================================================='
Write-Host 'BUYFLOW V17 - ROCm / PyTorch / QLoRA ENV SETUP'
Write-Host 'Target GPU: AMD Radeon RX 9060 XT (gfx1200, 16 GB)'
Write-Host 'Python: 3.14'
Write-Host 'Training: NOT STARTED'
Write-Host 'Model download: NOT STARTED'
Write-Host '=============================================================='

$pyLauncher = Get-Command py -ErrorAction Stop
$pyCheck = & py -3.14 -c "import sys; print(sys.executable); print(sys.version)" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Python 3.14 is not available through py -3.14. Output: $pyCheck" }
Write-Host $pyCheck

$root = Join-Path $env:USERPROFILE 'BuyFlowTools\v17-qlora'
$venvPython = Join-Path $root 'Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
  Write-Host ''
  Write-Host "Creating isolated environment: $root"
  & py -3.14 -m venv $root
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python virtual environment.' }
}

$python = $venvPython

Write-Host ''
Write-Host 'Updating pip tooling...'
& $python -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw 'pip tooling update failed.' }

Write-Host ''
Write-Host 'Installing AMD ROCm 10.0 runtime/libraries for gfx1200...'
& $python -m pip install --index-url 'https://stable.repo.amd.com/rocm/whl-next/' 'rocm[libraries,device-gfx1200]==10.0.0'
if ($LASTEXITCODE -ne 0) { throw 'ROCm 10.0 installation failed.' }

Write-Host ''
Write-Host 'Installing ROCm-enabled PyTorch 2.13 for gfx1200...'
& $python -m pip install --index-url 'https://stable.repo.amd.com/rocm/whl-next/' 'torch[device-gfx1200]==2.13.0+rocm10.0.0'
if ($LASTEXITCODE -ne 0) { throw 'ROCm PyTorch installation failed.' }

Write-Host ''
Write-Host 'Installing bitsandbytes AMD/Windows build...'
& $python -m pip install --upgrade bitsandbytes
if ($LASTEXITCODE -ne 0) { throw 'bitsandbytes installation failed.' }

Write-Host ''
Write-Host 'Running GPU smoke test...'
$test = @'
import json
import torch
import bitsandbytes as bnb

out = {
    "torch": torch.__version__,
    "hip": getattr(torch.version, "hip", None),
    "cuda_api_available": torch.cuda.is_available(),
    "device_count": torch.cuda.device_count(),
    "bitsandbytes": getattr(bnb, "__version__", "unknown"),
}
if not torch.cuda.is_available():
    raise SystemExit("ROCm GPU is not visible to PyTorch")

out["device"] = torch.cuda.get_device_name(0)
out["vram_gb"] = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)

x = torch.randn((512, 512), device="cuda", dtype=torch.float16)
y = x @ x
torch.cuda.synchronize()
out["fp16_matmul"] = bool(torch.isfinite(y).all().item())

try:
    xb = torch.randn((256, 256), device="cuda", dtype=torch.bfloat16)
    yb = xb @ xb
    torch.cuda.synchronize()
    out["bf16_matmul"] = bool(torch.isfinite(yb).all().item())
except Exception as e:
    out["bf16_matmul"] = False
    out["bf16_error"] = str(e)

print(json.dumps(out, ensure_ascii=False, indent=2))
'@

$testFile = Join-Path $env:TEMP 'buyflow-v17-rocm-smoke.py'
Set-Content -Path $testFile -Value $test -Encoding UTF8
& $python $testFile
if ($LASTEXITCODE -ne 0) { throw 'GPU smoke test failed.' }

Write-Host ''
Write-Host '=============================================================='
Write-Host 'BUYFLOW V17 QLORA ENV: READY'
Write-Host "Environment: $root"
Write-Host 'ROCm: installed'
Write-Host 'PyTorch GPU: PASS'
Write-Host 'bitsandbytes: installed'
Write-Host 'Training: NOT STARTED'
Write-Host 'Gemma weights: NOT DOWNLOADED'
Write-Host 'Production: OFF'
Write-Host '=============================================================='
