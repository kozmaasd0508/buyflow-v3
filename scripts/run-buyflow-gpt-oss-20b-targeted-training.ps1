$ErrorActionPreference = 'Stop'

$marker = Join-Path $env:USERPROFILE 'BuyFlowTools\gptoss-training\unsloth-python.txt'
if (-not (Test-Path $marker)) {
  throw 'Unsloth AMD preparation marker missing. Run run-buyflow-gpt-oss-unsloth-amd-prepare.ps1 first.'
}
$py = (Get-Content -Raw -Encoding UTF8 $marker).Trim()
if (-not (Test-Path $py)) { throw "Prepared Unsloth Python missing: $py" }

# Avoid fighting Ollama or another BuyFlow training process for VRAM.
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

$commit = 'ec93362606d86f2b8078d4c32426353cd1d41397'
$script = Join-Path $env:TEMP 'train-buyflow-gpt-oss-20b-unsloth-qlora-targeted1.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/train-buyflow-gpt-oss-20b-unsloth-qlora-targeted1.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

$env:UNSLOTH_ROCM_GFX_ARCH = 'gfx1200'
$env:UNSLOTH_STUDIO_HOME = Join-Path $env:USERPROFILE 'BuyFlowTools\unsloth-gptoss-amd'

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B TARGETED QLORA'
Write-Host 'Framework: Unsloth AMD | base: unsloth/gpt-oss-20b'
Write-Host 'Data: 2400 targeted train + 320 validation'
Write-Host 'Blind O2 is NOT used for training.'
Write-Host '1 epoch | QLoRA 4-bit | r=8 alpha=16 | lr=1e-4'
Write-Host 'Fresh Blind O3 will be the proof after training.'
Write-Host 'Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS targeted QLoRA failed with exit code $LASTEXITCODE" }
