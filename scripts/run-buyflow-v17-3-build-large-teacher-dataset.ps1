$ErrorActionPreference = 'Stop'

$commit = '963e519326d1df060f0ba208fb67b3e3d101e597'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

$out = "$env:USERPROFILE\Desktop\buyflow-v17-3-large-teacher"
$script = Join-Path $env:TEMP 'build-buyflow-v17-3-large-teacher-dataset.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/build-buyflow-v17-3-large-teacher-dataset.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Building BuyFlow V17.3 LARGE teacher dataset...'
Write-Host 'Target: 3000 train + 400 validation.'
Write-Host 'External Blind V2 is NOT read. Training is NOT started.'
Write-Host ''

& $node $script $out
if ($LASTEXITCODE -ne 0) { throw "V17.3 large teacher dataset build failed with exit code $LASTEXITCODE" }
