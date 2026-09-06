$ErrorActionPreference = 'Stop'
$commit = 'a75b7a7365d7a04a19937d81fdde1d358ec23cfb'
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

$chat = Join-Path $env:TEMP 'buyflow-gemma-chat.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/buyflow-gemma-chat.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $chat

& $node $chat
