$ErrorActionPreference = 'Stop'

$srcCommit = '087d01de4031d5dceb99dad261dfafaeddb3c2f3'
$py = 'C:\Python314\python.exe'
if (-not (Test-Path $py)) { $py = 'python.exe' }

$src = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-blind-o1-src.py'
$dst = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-blind-o1-jsonmode.py'
$url = "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$srcCommit/scripts/run-buyflow-gpt-oss-20b-blind-o1.py"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $src

$text = Get-Content -Raw -Encoding UTF8 $src
$old = '"format": SCHEMA,'
$new = '"format": "json",'
if (($text.Split($old).Count - 1) -ne 1) { throw 'Could not patch Ollama format exactly once' }
$text = $text.Replace($old, $new)
$text = $text.Replace('schema-constrained', 'JSON-mode')
$text = $text.Replace('Schema constrained', 'JSON-mode')
Set-Content -Encoding UTF8 -Path $dst -Value $text

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B BLIND O1 - JSON MODE RETRY'
Write-Host 'Reason: previous run had Errors=30, so it produced no scorable predictions.'
Write-Host 'This retry keeps the SAME hidden O1 cases because the first run never returned predictions.'
Write-Host 'Ollama format=json is used; enum validity is still scored client-side.'
Write-Host 'Blind V4/V5: NOT USED. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $dst
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS O1 JSON-mode retry failed with exit code $LASTEXITCODE" }
