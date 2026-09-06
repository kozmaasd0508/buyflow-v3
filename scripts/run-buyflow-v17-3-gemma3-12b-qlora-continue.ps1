$ErrorActionPreference = 'Stop'

$commit = '87241428fdc8b476c1b4ee5852b45fe1d9f3aec9'
$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$script = Join-Path $env:TEMP 'train-buyflow-v17-3-gemma3-12b-qlora-continue.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/train-buyflow-v17-3-gemma3-12b-qlora-continue.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Starting BuyFlow V17.3 REAL QLoRA continuation training...'
Write-Host 'Start: existing V17 trained adapter'
Write-Host 'Data: 3000 train + 400 validation'
Write-Host 'Plan: 1 epoch, lr=2e-5, grad_accum=8'
Write-Host 'External Blind V2 is NOT read. Production remains OFF.'
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17.3 QLoRA continuation failed with exit code $LASTEXITCODE" }
