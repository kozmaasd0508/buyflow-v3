$ErrorActionPreference = 'Stop'

$commit = 'ce0df50c82e0a4369f39d374f33792f6f6de4536'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'smoke-buyflow-v17-gemma3-12b-qlora-v2.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/smoke-buyflow-v17-gemma3-12b-qlora.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting Gemma 3 12B download + 4-bit GPU load smoke V2...'
Write-Host 'This can take a while on the first run because the original model weights are large.'
Write-Host 'Training is NOT started by this step.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "Gemma QLoRA smoke V2 failed with exit code $LASTEXITCODE" }
