$ErrorActionPreference = 'Stop'

$commit = '3e2bb9803af7bce4eae0e61c23945f67b3d35797'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

$out = Join-Path $env:USERPROFILE 'Desktop\buyflow-v17-teacher-dataset'
$script = Join-Path $env:TEMP 'build-buyflow-v17-teacher-dataset.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/build-buyflow-v17-teacher-dataset.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $script

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
& $node $script $out

Write-Host ''
Write-Host 'Files:'
Get-ChildItem $out | Select-Object Name,Length | Format-Table -AutoSize
Write-Host "Dataset folder: $out"
