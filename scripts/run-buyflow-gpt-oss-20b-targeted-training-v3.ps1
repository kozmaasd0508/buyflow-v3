$ErrorActionPreference = 'Stop'

$markerFile = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth-python.txt'
if (-not (Test-Path $markerFile)) { throw 'Unsloth AMD preparation marker missing.' }
$py = (Get-Content -Raw -Encoding UTF8 $markerFile).Trim()
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
$compile = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth_compiled_cache'
$hf = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\hf-cache'
New-Item -ItemType Directory -Force -Path $work,$compile,$hf | Out-Null

# Clean inherited override before Python starts. Unsloth may set its own AMD BNB
# compatibility value internally; the exact stack already passed GPU+BNB verify.
Remove-Item Env:BNB_ROCM_VERSION -ErrorAction SilentlyContinue
$env:UNSLOTH_ROCM_GFX_ARCH = 'gfx1200'
$env:UNSLOTH_STUDIO_HOME = Join-Path $env:USERPROFILE 'BuyFlowTools\unsloth-gptoss-amd'
$env:UNSLOTH_COMPILE_LOCATION = $compile
$env:HF_HOME = $hf
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:UNSLOTH_SKIP_AUTOSTART = '1'

$baseCommit = 'ec93362606d86f2b8078d4c32426353cd1d41397'
$v2Commit = '7f580b265663ef34008aca58a233688a6309ce63'
$v3Commit = '41872f4df90a4d446f0b20ca5c3ce36ff5ccf1da'

$src = Join-Path $env:TEMP 'train-buyflow-gpt-oss-targeted1-src.py'
$mid = Join-Path $env:TEMP 'train-buyflow-gpt-oss-targeted1-v2.py'
$dst = Join-Path $env:TEMP 'train-buyflow-gpt-oss-targeted1-v3.py'
$p2 = Join-Path $env:TEMP 'patch-buyflow-gpt-oss-targeted-training-v2.py'
$p3 = Join-Path $env:TEMP 'patch-buyflow-gpt-oss-targeted-training-v3.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/train-buyflow-gpt-oss-20b-unsloth-qlora-targeted1.py" -OutFile $src
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$v2Commit/scripts/patch-buyflow-gpt-oss-targeted-training-v2.py" -OutFile $p2
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$v3Commit/scripts/patch-buyflow-gpt-oss-targeted-training-v3.py" -OutFile $p3

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B TARGETED QLORA V3'
Write-Host 'Exact tokenizer diagnostic applied:'
Write-Host '  response marker = <|start|>assistant<|message|>'
Write-Host 'Data: 2400 train + 320 validation'
Write-Host 'Blind O2/O3 are NOT used for training.'
Write-Host '1 epoch | QLoRA 4-bit | r=8 alpha=16 | lr=1e-4'
Write-Host 'Real backward/OOM precheck runs before the long train.'
Write-Host 'Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $p2 $src $mid
if ($LASTEXITCODE -ne 0) { throw "V2 trainer patch failed with exit code $LASTEXITCODE" }
& $py $p3 $mid $dst
if ($LASTEXITCODE -ne 0) { throw "V3 Harmony marker patch failed with exit code $LASTEXITCODE" }

Push-Location $work
try {
  & $py $dst
  if ($LASTEXITCODE -ne 0) { throw "GPT-OSS targeted QLoRA V3 failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
