$ErrorActionPreference = 'Stop'

$commit = 'f43f1013c2b5160ffc88334df133d4cb7206a977'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow V17 QLoRA Python env missing: $py" }

$script = Join-Path $env:TEMP 'run-buyflow-v17-3-external-blind-v3-compare.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-v17-3-external-blind-v3-compare.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting fresh BuyFlow V17.3 External Blind V3 comparison...'
Write-Host 'Compares old 240-row adapter vs new 3000-row continuation.'
Write-Host 'Minimal prompt. Aggregate-only. Production OFF.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "External Blind V3 comparison failed with exit code $LASTEXITCODE" }
