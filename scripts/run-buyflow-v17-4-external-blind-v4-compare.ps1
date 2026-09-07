$ErrorActionPreference = 'Stop'

$commit = 'a34a64ba378c85faed2210923f8fba98e686de0e'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow V17 QLoRA Python env missing: $py" }

$script = Join-Path $env:TEMP 'run-buyflow-v17-4-external-blind-v4-compare.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-v17-4-external-blind-v4-compare.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting BuyFlow External Blind V4 comparison...'
Write-Host 'V17.3 baseline vs V17.4 candidate'
Write-Host '60 fresh hard cases | minimal prompt | aggregate-only'
Write-Host 'Blind V3 untouched. Production OFF.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "External Blind V4 comparison failed with exit code $LASTEXITCODE" }
