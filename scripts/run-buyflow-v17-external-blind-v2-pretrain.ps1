$ErrorActionPreference = 'Stop'
$builderCommit = 'b76ec8172f095e604732381603e6659b7ae403e3'
$runnerCommit = '4a8845caa30189b6cedfb1781c4ffce1ae1c42da'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

$out = "$env:USERPROFILE\Desktop\buyflow-v17-external-blind-v2"
$builder = Join-Path $env:TEMP 'build-buyflow-v17-external-blind-v2.mjs'
$runner = Join-Path $env:TEMP 'run-buyflow-v17-external-blind-v2-baseline.mjs'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$builderCommit/scripts/build-buyflow-v17-external-blind-v2.mjs" -OutFile $builder
& $node $builder $out

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/run-buyflow-v17-external-blind-v2-baseline.mjs" -OutFile $runner
& $node $runner $out
