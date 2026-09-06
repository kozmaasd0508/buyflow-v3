$ErrorActionPreference = 'Stop'

$builderCommit = '963e519326d1df060f0ba208fb67b3e3d101e597'
$patchCommit = '277c5ea7353df7c9839637680c75e26111a2d153'
$validatorCommit = 'fe160607d76712a86937b6aafdf7d833fda2204d'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

$out = "$env:USERPROFILE\Desktop\buyflow-v17-3-large"
$builder = Join-Path $env:TEMP 'build-buyflow-v17-3-large-teacher-dataset-v2.mjs'
$patcher = Join-Path $env:TEMP 'patch-buyflow-v17-3-large-teacher-builder-v2.mjs'
$validator = Join-Path $env:TEMP 'validate-buyflow-v17-3-large-teacher-dataset-v2.mjs'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$builderCommit/scripts/build-buyflow-v17-3-large-teacher-dataset.mjs" -OutFile $builder
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-v17-3-large-teacher-builder-v2.mjs" -OutFile $patcher
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$validatorCommit/scripts/validate-buyflow-v17-3-large-teacher-dataset-v2.mjs" -OutFile $validator

Write-Host 'Patching V17.3 large corpus builder V2...'
& $node $patcher $builder
if ($LASTEXITCODE -ne 0) { throw "V17.3 builder patch failed with exit code $LASTEXITCODE" }

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
Write-Host ''
Write-Host 'Building 3000 train + 400 validation V17.3 corpus...'
Write-Host 'External Blind V2 is NOT read. Training is NOT started.'
Write-Host ''
& $node $builder $out
if ($LASTEXITCODE -ne 0) { throw "V17.3 large teacher dataset V2 build failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Running strict uniqueness / split-overlap validation...'
& $node $validator $out
if ($LASTEXITCODE -ne 0) { throw "V17.3 strict corpus validation failed with exit code $LASTEXITCODE" }
