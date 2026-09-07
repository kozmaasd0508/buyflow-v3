$ErrorActionPreference = 'Stop'

$commit = '4ecb09c26f0550ab8bcf22fb699e6178c9b9ab63'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow V17 QLoRA Python env missing: $py" }

$active = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'train-buyflow-v17-5-targeted|train-buyflow-v17-.*qlora' }
if ($active) {
  Write-Host 'A BuyFlow training process appears to be running. Blind O2 will NOT start while training is active.'
  $active | Select-Object ProcessId, CommandLine | Format-List
  exit 2
}

$script = Join-Path $env:TEMP 'run-buyflow-gpt-oss-vs-gemma-v17-3-blind-o2.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-gpt-oss-vs-gemma-v17-3-blind-o2.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host '=============================================================='
Write-Host 'BUYFLOW FRESH BLIND O2'
Write-Host 'GPT-OSS 20B vs Gemma V17.3 on the SAME 40 fresh cases'
Write-Host 'Aggregate-only. O1 / Blind V4 / Blind V5 are not used.'
Write-Host 'GPT-OSS uses schema constraint + low thinking; Gemma uses deterministic generation.'
Write-Host 'Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "BuyFlow fresh Blind O2 comparison failed with exit code $LASTEXITCODE" }
