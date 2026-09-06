$ErrorActionPreference = 'Stop'

$commit = '29c6897c19b800e125d4f8ef6debf07dd255cb60'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'smoke-buyflow-v17-gemma3-12b-qlora.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/smoke-buyflow-v17-gemma3-12b-qlora.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting Gemma 3 12B download + 4-bit GPU load smoke...'
Write-Host 'This can take a while on the first run because the original model weights are large.'
Write-Host 'Training is NOT started by this step.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "Gemma QLoRA smoke failed with exit code $LASTEXITCODE" }
