$ErrorActionPreference = 'Stop'

$marker = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth-python.txt'
if (-not (Test-Path $marker)) {
  throw 'Unsloth AMD preparation marker missing.'
}
$py = (Get-Content -Raw -Encoding UTF8 $marker).Trim()
if (-not (Test-Path $py)) { throw "Prepared Unsloth Python missing: $py" }

# Avoid VRAM competition.
try { & ollama stop 'gpt-oss:20b' 2>$null | Out-Null } catch {}
try {
  $busy = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.ProcessId -ne $PID -and $_.Name -match '^python(\.exe)?$' -and $_.CommandLine -match 'train-buyflow|targeted-training'
  }
  if ($busy) {
    $busy | Select-Object ProcessId, CommandLine | Format-List
    throw 'Another BuyFlow training process appears to be running.'
  }
} catch {
  if ($_.Exception.Message -like 'Another BuyFlow*') { throw }
}

$work = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\targeted1-work'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$compile = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth_compiled_cache'
$hf = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\hf-cache'
New-Item -ItemType Directory -Force -Path $compile,$hf | Out-Null

# Clear stale Gemma/bitsandbytes override in this process.
Remove-Item Env:BNB_ROCM_VERSION -ErrorAction SilentlyContinue
$env:UNSLOTH_ROCM_GFX_ARCH = 'gfx1200'
$env:UNSLOTH_STUDIO_HOME = Join-Path $env:USERPROFILE 'BuyFlowTools\unsloth-gptoss-amd'
$env:UNSLOTH_COMPILE_LOCATION = $compile
$env:HF_HOME = $hf
$env:UNSLOTH_SKIP_AUTOSTART = '1'

$srcCommit = 'ec93362606d86f2b8078d4c32426353cd1d41397'
$patchCommit = '7f580b265663ef34008aca58a233688a6309ce63'
$src = Join-Path $env:TEMP 'train-buyflow-gpt-oss-20b-unsloth-qlora-targeted1-src.py'
$dst = Join-Path $env:TEMP 'train-buyflow-gpt-oss-20b-unsloth-qlora-targeted1-v2.py'
$patcher = Join-Path $env:TEMP 'patch-buyflow-gpt-oss-targeted-training-v2.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$srcCommit/scripts/train-buyflow-gpt-oss-20b-unsloth-qlora-targeted1.py" -OutFile $src
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-gpt-oss-targeted-training-v2.py" -OutFile $patcher

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B TARGETED QLORA V2'
Write-Host 'Framework: Unsloth AMD | GPU: RX 9060 XT gfx1200'
Write-Host 'Data: 2400 train + 320 validation'
Write-Host 'Blind O2 is NOT used for training.'
Write-Host '1 epoch | QLoRA 4-bit | r=8 alpha=16 | lr=1e-4'
Write-Host 'Adds: clean BNB env + writable compile cache + real backward/OOM precheck.'
Write-Host 'Fresh Blind O3 will be the proof after training.'
Write-Host 'Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $patcher $src $dst
if ($LASTEXITCODE -ne 0) { throw "Trainer V2 patch failed with exit code $LASTEXITCODE" }

Push-Location $work
try {
  & $py $dst
  if ($LASTEXITCODE -ne 0) { throw "GPT-OSS targeted QLoRA V2 failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
