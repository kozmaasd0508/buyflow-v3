$ErrorActionPreference = 'Stop'

$commit = '19de1782130410609393073856caffa961fe4df4'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'smoke-buyflow-v17-gemma3-12b-qlora-text-v3.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/smoke-buyflow-v17-gemma3-12b-qlora-text-v3.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting Gemma 3 12B TEXT-ONLY 4-bit + LoRA attach smoke V3...'
Write-Host 'Uses the already-downloaded local model. No full re-download.'
Write-Host 'Training is NOT started by this step.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "Gemma text QLoRA smoke V3 failed with exit code $LASTEXITCODE" }
