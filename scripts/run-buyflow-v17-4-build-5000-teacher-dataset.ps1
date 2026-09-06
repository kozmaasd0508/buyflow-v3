$ErrorActionPreference = 'Stop'

$baseBuilderCommit = '963e519326d1df060f0ba208fb67b3e3d101e597'
$patchCommit = 'ae2e0d1b8a9a1897ce0f4adc8d8e051d36c18ee4'
$validatorCommit = 'f323e58530a56534043914f331620d7314ab048c'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

$out = "$env:USERPROFILE\Desktop\buyflow-v17-4-5000"
$builder = Join-Path $env:TEMP 'build-buyflow-v17-4-5000-teacher-dataset.mjs'
$patcher = Join-Path $env:TEMP 'patch-buyflow-v17-4-5000-teacher-builder.mjs'
$validator = Join-Path $env:TEMP 'validate-buyflow-v17-4-5000-teacher-dataset.mjs'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseBuilderCommit/scripts/build-buyflow-v17-3-large-teacher-dataset.mjs" -OutFile $builder
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-v17-4-5000-teacher-builder.mjs" -OutFile $patcher
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$validatorCommit/scripts/validate-buyflow-v17-4-5000-teacher-dataset.mjs" -OutFile $validator

Write-Host 'Preparing BuyFlow V17.4 5000-row teacher corpus...'
Write-Host 'Target: 5000 train + 600 validation.'
Write-Host 'Focus: link_status hardening + lifecycle boundaries.'
Write-Host 'External Blind V3 is NOT read. Training is NOT started.'
Write-Host ''

& $node $patcher $builder
if ($LASTEXITCODE -ne 0) { throw "V17.4 builder patch failed with exit code $LASTEXITCODE" }

& $node $builder $out
if ($LASTEXITCODE -ne 0) { throw "V17.4 dataset build failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Running strict uniqueness / split-overlap / link-status validation...'
& $node $validator $out
if ($LASTEXITCODE -ne 0) { throw "V17.4 strict validation failed with exit code $LASTEXITCODE" }
