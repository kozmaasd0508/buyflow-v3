$ErrorActionPreference = 'Stop'

$marker = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth-python.txt'
if (-not (Test-Path $marker)) { throw 'Unsloth AMD preparation marker missing.' }
$py = (Get-Content -Raw -Encoding UTF8 $marker).Trim()
if (-not (Test-Path $py)) { throw "Prepared Unsloth Python missing: $py" }

try { & ollama stop 'gpt-oss:20b' 2>$null | Out-Null } catch {}

$work = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\harmony-diagnostic-work'
$compile = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth_compiled_cache'
$hf = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\hf-cache'
New-Item -ItemType Directory -Force -Path $work,$compile,$hf | Out-Null
Remove-Item Env:BNB_ROCM_VERSION -ErrorAction SilentlyContinue
$env:UNSLOTH_ROCM_GFX_ARCH = 'gfx1200'
$env:UNSLOTH_COMPILE_LOCATION = $compile
$env:HF_HOME = $hf
$env:UNSLOTH_SKIP_AUTOSTART = '1'

$commit = 'a0f2861f7f185447f9b43e3d62ab0d1a7e98e5b4'
$script = Join-Path $env:TEMP 'diagnose-buyflow-gpt-oss-harmony-template.py'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/diagnose-buyflow-gpt-oss-harmony-template.py" -OutFile $script

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS HARMONY TEMPLATE DIAGNOSTIC'
Write-Host 'Purpose: discover the exact rendered assistant-final boundary.'
Write-Host 'NO TRAINING. Blind O2/O3 NOT USED. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

Push-Location $work
try {
  & $py $script
  if ($LASTEXITCODE -ne 0) { throw "Harmony diagnostic failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
