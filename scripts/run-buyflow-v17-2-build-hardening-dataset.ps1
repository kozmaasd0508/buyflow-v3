$ErrorActionPreference = 'Stop'

$commit = 'c5a14e673dbc641bc93dd61ed0cfbd4e1f3f5f34'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

$out = "$env:USERPROFILE\Desktop\buyflow-v17-2-hardening"
$script = Join-Path $env:TEMP 'build-buyflow-v17-2-hardening-dataset.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/build-buyflow-v17-2-hardening-dataset.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

Write-Host 'Building BuyFlow V17.2 hardening dataset...'
Write-Host 'This does NOT train yet and does NOT read External Blind V2.'
Write-Host ''

& $node $script $out
if ($LASTEXITCODE -ne 0) { throw "V17.2 hardening dataset build failed with exit code $LASTEXITCODE" }
