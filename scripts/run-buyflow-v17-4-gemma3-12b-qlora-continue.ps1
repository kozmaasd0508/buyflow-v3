$ErrorActionPreference = 'Stop'

$sourceCommit = 'b33b7d4d190366f7acd01dbbd9a546e2dede3584'
$patchCommit = '18004d3cea184d30172fa4d5f655171469a67ec3'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow V17 QLoRA Python env missing: $py" }

$trainer = Join-Path $env:TEMP 'train-buyflow-v17-4-gemma3-12b-qlora-continue.py'
$patcher = Join-Path $env:TEMP 'patch-buyflow-v17-4-qlora-continuation.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$sourceCommit/scripts/train-buyflow-v17-3-gemma3-12b-qlora-continue.py" -OutFile $trainer
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-v17-4-qlora-continuation.py" -OutFile $patcher

Write-Host 'Preparing BuyFlow V17.4 REAL QLoRA continuation training...'
& $py $patcher $trainer
if ($LASTEXITCODE -ne 0) { throw "V17.4 trainer patch failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Starting BuyFlow V17.4 REAL QLoRA continuation training...'
Write-Host 'Start: V17.3 trained adapter (Blind V3 exact 85%)'
Write-Host 'Data: 5000 train + 600 validation'
Write-Host 'Plan: 1 epoch, lr=1e-5, grad_accum=8'
Write-Host 'External Blind V3 is NOT read. Production remains OFF.'
Write-Host ''

& $py $trainer
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17.4 QLoRA continuation failed with exit code $LASTEXITCODE" }
