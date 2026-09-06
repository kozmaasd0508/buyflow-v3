$ErrorActionPreference = 'Stop'

$commit = '4732facb1ac3d55cd6e47e90d93c7b73fc65af60'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'train-buyflow-v17-gemma3-12b-qlora-v3.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/train-buyflow-v17-gemma3-12b-qlora-v3.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting BuyFlow V17 Gemma 3 12B QLoRA training V3...'
Write-Host 'First validates assistant boundaries for all 270 train/validation rows.'
Write-Host 'External Blind V2 is NOT read. Production remains OFF.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17 QLoRA training V3 failed with exit code $LASTEXITCODE" }
