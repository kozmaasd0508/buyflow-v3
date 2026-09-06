$ErrorActionPreference = 'Stop'
$commit = '5c083212156ea90bb2b32b40bcc1af47167104b8'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

try {
  $tags = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
} catch {
  throw 'Ollama is not running on http://127.0.0.1:11434'
}
$modelNames = @($tags.models | ForEach-Object { if ($_.name) { $_.name } else { $_.model } })
if (-not ($modelNames -contains 'gemma3:12b')) {
  throw "gemma3:12b is not installed. Installed models: $($modelNames -join ', ')"
}

$dir = "$env:USERPROFILE\Desktop\buyflow-v17-external-blind"
if (-not (Test-Path "$dir\blind-input.jsonl")) { throw "Missing blind-input.jsonl in $dir" }
if (-not (Test-Path "$dir\blind-gold.jsonl")) { throw "Missing blind-gold.jsonl in $dir" }

$runner = Join-Path $env:TEMP 'run-buyflow-v17-external-blind-baseline.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-v17-external-blind-baseline.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $runner
& $node $runner $dir
