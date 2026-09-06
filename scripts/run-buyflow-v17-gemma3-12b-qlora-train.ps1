$ErrorActionPreference = 'Stop'

$commit = '0b86a20b8e6da51e4cdadf94f2cc8497787d2687'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'train-buyflow-v17-gemma3-12b-qlora.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/train-buyflow-v17-gemma3-12b-qlora.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting REAL BuyFlow V17 Gemma 3 12B QLoRA training...'
Write-Host 'Uses cached Gemma weights and the frozen 240/30 teacher dataset.'
Write-Host 'External Blind V2 is NOT read by this training step.'
Write-Host 'Production remains OFF.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17 QLoRA training failed with exit code $LASTEXITCODE" }
