$ErrorActionPreference = 'Stop'

$commit = '087d01de4031d5dceb99dad261dfafaeddb3c2f3'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow Python env missing: $py" }

$activeTraining = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine -like '*train-buyflow-v17-5-targeted.py*'
}
if ($activeTraining) {
  Write-Host 'V17.5 TRAINING IS STILL RUNNING.' -ForegroundColor Yellow
  Write-Host 'GPT-OSS blind test was NOT started to avoid GPU contention.'
  Write-Host 'Let the V17.5 training finish first, then run this same command again.'
  exit 2
}

$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) { throw 'Ollama command not found.' }
$models = (& ollama list | Out-String)
if ($models -notmatch 'gpt-oss:20b') { throw 'gpt-oss:20b is not installed. Run: ollama pull gpt-oss:20b' }

$script = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-blind-o1.py'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-gpt-oss-20b-blind-o1.py" -OutFile $script

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS-20B BLIND O1'
Write-Host '30 fresh cases | aggregate-only | structured JSON schema'
Write-Host 'No training. Blind V4/V5 untouched. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $script
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS Blind O1 failed with exit code $LASTEXITCODE" }
