$ErrorActionPreference = 'Stop'
$commit = '6ca8d163ef5159992dd6ad59b6370cb3b715dbc6'
$node = "$env:USERPROFILE\BuyFlowTools\node-v24.20.0-win-x64\node.exe"
if (-not (Test-Path $node)) { throw "Portable Node 24 not found: $node" }

function Test-Ollama {
  try {
    $null = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
    return $true
  } catch { return $false }
}

if (-not (Test-Ollama)) {
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollama) {
    $default = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    if (Test-Path $default) { $ollamaPath = $default } else { throw 'Ollama is not running and ollama.exe was not found.' }
  } else { $ollamaPath = $ollama.Source }
  Write-Host 'Ollama is not running. Starting it now...'
  Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WindowStyle Minimized
  $ready = $false
  for ($i=0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Ollama) { $ready = $true; break }
  }
  if (-not $ready) { throw 'Ollama did not become ready on port 11434.' }
}

$tags = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
$modelNames = @($tags.models | ForEach-Object { if ($_.name) { $_.name } else { $_.model } })
if (-not ($modelNames -contains 'gemma3:12b')) {
  throw "gemma3:12b is not installed. Installed models: $($modelNames -join ', ')"
}

$test = Join-Path $env:TEMP 'test-buyflow-gemma-chat-linking20.mjs'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/test-buyflow-gemma-chat-linking20.mjs"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $test

& $node $test
