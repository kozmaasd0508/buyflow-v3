$ErrorActionPreference = 'Stop'

$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

$baseCommit = '0b86a20b8e6da51e4cdadf94f2cc8497787d2687'
$patchCommit = 'c0ae85dbea50c1a4e9e21ee5d561e0c3a24e131b'
$trainer = Join-Path $env:TEMP 'train-buyflow-v17-gemma3-12b-qlora-v2.py'
$patcher = Join-Path $env:TEMP 'patch-buyflow-v17-qlora-trainer-v2.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/train-buyflow-v17-gemma3-12b-qlora.py" -OutFile $trainer
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-v17-qlora-trainer-v2.py" -OutFile $patcher

Write-Host 'Patching BuyFlow V17 QLoRA trainer V2...'
& $py $patcher $trainer
if ($LASTEXITCODE -ne 0) { throw "Trainer V2 patch failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Starting REAL BuyFlow V17 Gemma 3 12B QLoRA training V2...'
Write-Host 'Dataset files are unchanged. External Blind V2 is NOT read.'
Write-Host 'Production remains OFF.'
Write-Host ''

& $py $trainer
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17 QLoRA training V2 failed with exit code $LASTEXITCODE" }
