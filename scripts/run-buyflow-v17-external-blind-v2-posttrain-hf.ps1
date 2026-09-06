$ErrorActionPreference = 'Stop'

$commit = 'ac3f18d77b7acde8ab9b21d674d5d499891c1bdd'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'run-buyflow-v17-external-blind-v2-posttrain-hf.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-v17-external-blind-v2-posttrain-hf.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting frozen BuyFlow V17 External Blind V2 POSTTRAIN evaluation...'
Write-Host 'Uses cached Gemma 3 12B + trained QLoRA adapter.'
Write-Host 'Per-case gold/failures remain hidden. Production OFF.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17 External Blind V2 posttrain evaluation failed with exit code $LASTEXITCODE" }
