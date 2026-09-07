$ErrorActionPreference = 'Stop'

$home = Join-Path $env:USERPROFILE 'BuyFlowTools\unsloth-gptoss-amd'

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B - UNSLOTH AMD PREPARE'
Write-Host 'Goal: isolated QLoRA environment for RX 9060 XT / gfx1200.'
Write-Host 'Existing Gemma v17-qlora environment will NOT be modified.'
Write-Host 'No training starts in this step. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

# Refuse to compete with an active BuyFlow training process.
try {
  $busy = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.Name -match '^python(\.exe)?$' -and $_.CommandLine -match 'buyflow.*train|train-buyflow|targeted-training'
  }
  if ($busy) {
    Write-Host 'A BuyFlow Python training process appears to be running:'
    $busy | Select-Object ProcessId, CommandLine | Format-List
    throw 'Stop/finish the existing training before preparing GPT-OSS.'
  }
} catch {
  if ($_.Exception.Message -like 'Stop/finish*') { throw }
}

# Free Ollama VRAM if the inference model is still resident.
try { & ollama stop 'gpt-oss:20b' 2>$null | Out-Null } catch {}

$env:UNSLOTH_STUDIO_HOME = $home
$env:UNSLOTH_SKIP_AUTOSTART = '1'
$env:UNSLOTH_PYTHON = '3.13'
$env:UNSLOTH_ROCM_GFX_ARCH = 'gfx1200'
$env:UNSLOTH_LLAMA_CPP_BACKEND = 'rocm'
$env:UNSLOTH_VERBOSE = '1'

Write-Host ('Isolated Unsloth home: ' + $home)
Write-Host 'Pinned GPU arch: gfx1200'
Write-Host 'Installing/updating official Unsloth Windows AMD stack...'
Write-Host ''

$installer = Invoke-RestMethod -UseBasicParsing 'https://unsloth.ai/install.ps1'
& ([scriptblock]::Create($installer))

Write-Host ''
Write-Host 'Locating isolated Python runtime...'
$pyCandidates = Get-ChildItem -Path $home -Recurse -Filter python.exe -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\Scripts\\python\.exe$|\\python\.exe$' } |
  Sort-Object FullName

if (-not $pyCandidates) {
  throw "Unsloth installation completed but no Python runtime was found under $home"
}

# Prefer a venv/Studio runtime that can import unsloth + torch.
$selected = $null
foreach ($c in $pyCandidates) {
  & $c.FullName -c "import torch, unsloth; print('probe-ok')" *> $null
  if ($LASTEXITCODE -eq 0) { $selected = $c.FullName; break }
}
if (-not $selected) {
  throw 'No isolated Python candidate could import both torch and unsloth.'
}

$markerDir = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training'
New-Item -ItemType Directory -Force -Path $markerDir | Out-Null
Set-Content -Encoding UTF8 -Path (Join-Path $markerDir 'unsloth-python.txt') -Value $selected

Write-Host ('Selected Python: ' + $selected)
Write-Host ''
Write-Host 'Running AMD/ROCm/Unsloth smoke check...'
& $selected -c @'
import json, torch, unsloth
info = {
  'torch': torch.__version__,
  'hip': getattr(torch.version, 'hip', None),
  'cuda_api_available': torch.cuda.is_available(),
  'device_count': torch.cuda.device_count() if torch.cuda.is_available() else 0,
  'device': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
  'vram_gb': round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2) if torch.cuda.is_available() else None,
  'unsloth': getattr(unsloth, '__version__', 'unknown'),
}
print(json.dumps(info, indent=2))
assert torch.cuda.is_available(), 'ROCm GPU is not visible to PyTorch'
name = torch.cuda.get_device_name(0).lower()
assert 'amd' in name or 'radeon' in name, f'Unexpected GPU: {name}'
print('BUYFLOW GPT-OSS UNSLOTH AMD PREPARE: PASS')
'@
if ($LASTEXITCODE -ne 0) { throw "AMD/Unsloth smoke failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Preparation complete. Training has NOT started.'
Write-Host 'Next step: GPT-OSS 20B QLoRA model-load/backward preflight, then targeted training.'
Write-Host 'Production: OFF'
