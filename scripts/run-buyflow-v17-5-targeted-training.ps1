$ErrorActionPreference = 'Stop'

$builderCommit = '7f0e8c13cdfefdac10e14410bc321a03e898c405'
$baseTrainerCommit = 'b33b7d4d190366f7acd01dbbd9a546e2dede3584'
$patchCommit = '46a8456b672f92ec16f464d688815d7aecd14b79'
$py = "$env:USERPROFILE\BuyFlowTools\v17-qlora\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "BuyFlow V17 QLoRA Python env missing: $py" }

$builder = Join-Path $env:TEMP 'build-buyflow-v17-5-targeted-teacher.py'
$trainer = Join-Path $env:TEMP 'train-buyflow-v17-5-targeted.py'
$patcher = Join-Path $env:TEMP 'patch-buyflow-v17-5-targeted-qlora.py'

Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$builderCommit/scripts/build-buyflow-v17-5-targeted-teacher.py" -OutFile $builder
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseTrainerCommit/scripts/train-buyflow-v17-3-gemma3-12b-qlora-continue.py" -OutFile $trainer
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$patchCommit/scripts/patch-buyflow-v17-5-targeted-qlora.py" -OutFile $patcher

Write-Host '=============================================================='
Write-Host 'BUYFLOW V17.5 TARGETED TRAINING'
Write-Host 'Start: V17.3 champion adapter'
Write-Host 'Corpus: 2400 targeted train + 320 disjoint validation'
Write-Host 'Focus: closed event taxonomy, link_status, perspective, refund/return boundary, ID safety'
Write-Host 'Blind V4 examples are NOT copied into the corpus.'
Write-Host 'Fresh Blind V5 remains untouched. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

$out = "$env:USERPROFILE\Desktop\buyflow-v17-5-targeted"
& $py $builder --out $out
if ($LASTEXITCODE -ne 0) { throw "V17.5 targeted corpus build/validation failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Patching proven V17.3 trainer for V17.5...'
& $py $patcher $trainer
if ($LASTEXITCODE -ne 0) { throw "V17.5 trainer patch failed with exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'Starting REAL V17.5 QLoRA training...'
Write-Host 'Plan: 1 epoch | batch=1 | grad_accum=8 | lr=8e-6 | checkpoints every 600 rows'
Write-Host 'Expected runtime on current GPU: roughly 80-100 minutes.'
Write-Host ''
& $py $trainer
if ($LASTEXITCODE -ne 0) { throw "BuyFlow V17.5 targeted QLoRA training failed with exit code $LASTEXITCODE" }
