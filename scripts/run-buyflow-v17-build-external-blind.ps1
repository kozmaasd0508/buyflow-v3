$ErrorActionPreference = 'Stop'
$commit = '49a915be251f19055f3c17b7db9ece65176c6e63'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }
$out = "$env:USERPROFILE\Desktop\buyflow-v17-external-blind"
$script = Join-Path $env:TEMP 'build-buyflow-v17-external-blind.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/build-buyflow-v17-external-blind.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script
& $node $script $out
Write-Host ''
Write-Host "External blind folder: $out"
Get-ChildItem $out | Select-Object Name,Length
