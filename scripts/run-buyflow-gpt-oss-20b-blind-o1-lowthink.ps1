$ErrorActionPreference = 'Stop'

$sourceCommit = '087d01de4031d5dceb99dad261dfafaeddb3c2f3'
$patchCommit = 'f7d07f1a80eb65e714291fe70db7b8230f76ba1c'
$py = 'C:\Python314\python.exe'
if (-not (Test-Path $py)) { $py = 'python.exe' }

$src = Join-Path $env:TEMP 'run-buyflow-gpt-oss-20b-blind-o1-lowthink.py'
$patcher = Join-Path $env:TEMP 'patch-buyflow-gpt-oss-o1-lowthink.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$sourceCommit/scripts/run-buyflow-gpt-oss-20b-blind-o1.py" -OutFile $src
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-gpt-oss-o1-lowthink.py" -OutFile $patcher

& $py $patcher $src
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS low-think patch failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host '=============================================================='
Write-Host 'BUYFLOW GPT-OSS 20B BLIND O1 - LOW THINK RETRY'
Write-Host 'Reason: prior runs exhausted the 128-token budget entirely in reasoning and returned empty content.'
Write-Host 'Runtime: format=json | think=low | num_predict=256'
Write-Host 'Same O1 holdout retained: no prior run produced scorable predictions.'
Write-Host 'Blind V4/V5: NOT USED. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

& $py $src
if ($LASTEXITCODE -ne 0) { throw "GPT-OSS O1 low-think retry failed with exit code $LASTEXITCODE" }
