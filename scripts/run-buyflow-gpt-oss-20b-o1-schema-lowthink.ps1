$ErrorActionPreference = 'Stop'

$srcCommit = '087d01de4031d5dceb99dad261dfafaeddb3c2f3'
$py = 'C:\Python314\python.exe'
if (-not (Test-Path $py)) { $py = 'python.exe' }

$src = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-blind-o1-src.py'
$dst = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-o1-schema-lowthink.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$srcCommit/scripts/run-buyflow-gpt-oss-20b-blind-o1.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $src

$text = Get-Content -Raw -Encoding UTF8 $src

$oldOptions = '"options": {"temperature": 0, "num_predict": 128},'
$newOptions = '"think": "low",`r`n        "options": {"temperature": 0, "num_predict": 512},'
$optCount = [regex]::Matches($text, [regex]::Escape($oldOptions)).Count
if ($optCount -ne 1) { throw "Could not patch options exactly once (found $optCount)" }
$text = $text.Replace($oldOptions, $newOptions)

$oldBanner = 'Runtime: Ollama structured JSON schema + closed BuyFlow enums'
$newBanner = 'Runtime: Ollama JSON SCHEMA + closed enums + think=low + num_predict=512'
$text = $text.Replace($oldBanner, $newBanner)

Set-Content -Encoding UTF8 -Path $dst -Value $text

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B O1 TECHNICAL RETRY'
Write-Host 'Schema constraint RESTORED.'
Write-Host 'think=low | num_predict=512'
Write-Host 'Purpose: verify the harness/model can return constrained JSON.'
Write-Host 'O1 is now regression/technical only, NOT a fresh blind benchmark.'
Write-Host 'If this succeeds, the next real measurement will be a fresh Blind O2.'
Write-Host 'Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $dst
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS O1 schema low-think retry failed with exit code $LASTEXITCODE" }
