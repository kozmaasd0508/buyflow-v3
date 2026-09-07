$ErrorActionPreference = 'Stop'

$unslothHome = Join-Path $env:USERPROFILE 'BuyFlowTools\unsloth-gptoss-amd'
$py = Join-Path $unslothHome 'unsloth_studio\Scripts\python.exe'
if (-not (Test-Path $py)) { throw "Expected Unsloth Python not found: $py" }

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B - UNSLOTH AMD VERIFY'
Write-Host 'Uses the already-installed isolated Unsloth environment.'
Write-Host 'No reinstall. No training. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

# Important: do not inherit an old bitsandbytes ROCm override from the Gemma env.
if (Test-Path Env:BNB_ROCM_VERSION) {
  Write-Host ('Removing inherited BNB_ROCM_VERSION=' + $env:BNB_ROCM_VERSION)
  Remove-Item Env:BNB_ROCM_VERSION
}

$env:UNSLOTH_STUDIO_HOME = $unslothHome
$env:UNSLOTH_ROCM_GFX_ARCH = 'gfx1200'
$env:UNSLOTH_LLAMA_CPP_BACKEND = 'rocm'
$env:UNSLOTH_SKIP_AUTOSTART = '1'

$markerDir = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training'
New-Item -ItemType Directory -Force -Path $markerDir | Out-Null
Set-Content -Encoding UTF8 -Path (Join-Path $markerDir 'unsloth-python.txt') -Value $py

$probe = Join-Path $env:TEMP 'buyflow-gptoss-unsloth-amd-verify.py'
$stdout = Join-Path $env:TEMP 'buyflow-gptoss-unsloth-amd-verify.out.txt'
$stderr = Join-Path $env:TEMP 'buyflow-gptoss-unsloth-amd-verify.err.txt'

@'
import json
import torch
import bitsandbytes as bnb
import unsloth

info = {
    'torch': torch.__version__,
    'hip': getattr(torch.version, 'hip', None),
    'cuda_api_available': torch.cuda.is_available(),
    'device_count': torch.cuda.device_count() if torch.cuda.is_available() else 0,
    'device': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    'vram_gb': round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2) if torch.cuda.is_available() else None,
    'unsloth': getattr(unsloth, '__version__', 'unknown'),
    'bitsandbytes': getattr(bnb, '__version__', 'unknown'),
}
print(json.dumps(info, indent=2))

assert torch.cuda.is_available(), 'ROCm GPU is not visible to PyTorch'
name = torch.cuda.get_device_name(0).lower()
assert 'amd' in name or 'radeon' in name, f'Unexpected GPU: {name}'

# Real GPU math smoke.
a = torch.randn((1024, 1024), device='cuda', dtype=torch.float16)
b = torch.randn((1024, 1024), device='cuda', dtype=torch.float16)
c = a @ b
torch.cuda.synchronize()
assert torch.isfinite(c).all().item(), 'GPU matmul produced non-finite output'
print('GPU MATMUL: PASS')

# Verify bitsandbytes sees the runtime without forcing an old ROCm version.
print('BNB IMPORT: PASS')
print('BUYFLOW GPT-OSS UNSLOTH AMD VERIFY: PASS')
'@ | Set-Content -Encoding UTF8 -Path $probe

Remove-Item $stdout,$stderr -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $py -ArgumentList @($probe) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr

if (Test-Path $stdout) { Get-Content $stdout }
if (Test-Path $stderr) {
  $errText = Get-Content $stderr -Raw
  if (-not [string]::IsNullOrWhiteSpace($errText)) {
    Write-Host ''
    Write-Host 'Non-fatal stderr / warnings from Python:'
    Write-Host $errText
  }
}

if ($p.ExitCode -ne 0) { throw "Unsloth AMD verify failed with exit code $($p.ExitCode)" }

Write-Host ''
Write-Host 'Verification complete. Training has NOT started.'
Write-Host 'Next: GPT-OSS 20B 4-bit model-load + LoRA backward preflight.'
Write-Host 'Production: OFF'
