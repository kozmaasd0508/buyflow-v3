$ErrorActionPreference = 'Stop'

$srcCommit = '087d01de4031d5dceb99dad261dfafaeddb3c2f3'
$patchCommit = '794ebff6e86234c1d6f0dec2dc50d97d57f9a37a'
$py = 'C:\Python314\python.exe'
if (-not (Test-Path $py)) { $py = 'python.exe' }

$src = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-blind-o1-src.py'
$dst = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-o1-schema-lowthink-v2.py'
$patcher = Join-Path $env:TEMP 'patch-buyflow-gpt-oss-o1-schema-lowthink.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$srcCommit/scripts/run-buyflow-gpt-oss-20b-blind-o1.py" -OutFile $src
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-gpt-oss-o1-schema-lowthink.py" -OutFile $patcher

Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B O1 TECHNICAL RETRY V2'
Write-Host 'Schema constraint: ON'
Write-Host 'think=low | num_predict=512'
Write-Host 'Purpose: verify constrained JSON output without touching O1 cases/scoring.'
Write-Host 'O1 is technical/regression only. Fresh Blind O2 comes next if this passes.'
Write-Host 'Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $patcher $src $dst
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS O1 Python patch failed with exit code $LASTEXITCODE" }

Write-Host ''
& $py $dst
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS O1 schema low-think V2 retry failed with exit code $LASTEXITCODE" }
