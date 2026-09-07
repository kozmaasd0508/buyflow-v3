$ErrorActionPreference = 'Stop'

$benchmarkCommit = 'a34a64ba378c85faed2210923f8fba98e686de0e'
$diagnosticCommit = '332720acbe87b999604d43f47cc3f2137c2d7fba'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow V17 QLoRA Python env missing: $py" }

$benchmark = Join-Path $env:TEMP 'run-buyflow-v17-4-external-blind-v4-compare.py'
$diagnostic = Join-Path $env:TEMP 'run-buyflow-v17-4-blind-v4-closed-diagnostic.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$benchmarkCommit/scripts/run-buyflow-v17-4-external-blind-v4-compare.py" -OutFile $benchmark
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$diagnosticCommit/scripts/run-buyflow-v17-4-blind-v4-closed-diagnostic.py" -OutFile $diagnostic

Write-Host 'Starting CLOSED Blind V4 diagnostic...'
Write-Host 'This reruns V17.3 and V17.4 on the spent V4 benchmark and reveals failure groups.'
Write-Host 'NO TRAINING. Blind V5 untouched. Production OFF.'
Write-Host ''

& $py $diagnostic --benchmark-script $benchmark
if ($LASTEXITCODE -ne 0) { throw "Blind V4 diagnostic failed with exit code $LASTEXITCODE" }
