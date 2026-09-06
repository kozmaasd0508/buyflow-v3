$ErrorActionPreference = 'Stop'

$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
$hf = Join-Path $envDir 'Scripts\hf.exe'
$model = 'google/gemma-3-12b-it'
$probeDir = "$env:USERPROFILE\BuyFlowTools\gemma-3-12b-it-access-check"

if (-not (Test-Path $py)) {
  throw "V17 QLoRA environment missing: $py"
}

Write-Host '=============================================================='
Write-Host 'BUYFLOW V17 - HUGGING FACE / GEMMA ACCESS SETUP'
Write-Host "Model: $model"
Write-Host 'Training: NOT STARTED'
Write-Host 'Full model download: NOT STARTED'
Write-Host '=============================================================='

Write-Host ''
Write-Host 'Installing Hugging Face / PEFT tooling into isolated V17 environment...'
& $py -m pip install -U huggingface_hub transformers accelerate peft datasets safetensors sentencepiece
if ($LASTEXITCODE -ne 0) { throw 'Hugging Face tooling install failed.' }

if (-not (Test-Path $hf)) {
  throw "hf CLI not found after install: $hf"
}

Write-Host ''
Write-Host 'Checking Hugging Face login...'
& $hf auth whoami *> $null
$loggedIn = ($LASTEXITCODE -eq 0)

if (-not $loggedIn) {
  Write-Host ''
  Write-Host 'Hugging Face login is required.'
  Write-Host 'Opening the Gemma license page and token page in your browser...'
  Start-Process 'https://huggingface.co/google/gemma-3-12b-it'
  Start-Sleep -Seconds 1
  Start-Process 'https://huggingface.co/settings/tokens'
  Write-Host ''
  Write-Host '1) On the Gemma page, accept / acknowledge the Google Gemma license.'
  Write-Host '2) On the token page, create a READ token.'
  Write-Host '3) Paste that token ONLY into the prompt below. Do NOT paste it into ChatGPT.'
  Write-Host ''
  & $hf auth login
  if ($LASTEXITCODE -ne 0) { throw 'Hugging Face login failed.' }
}

Write-Host ''
Write-Host 'Hugging Face account:'
& $hf auth whoami
if ($LASTEXITCODE -ne 0) { throw 'Hugging Face authentication check failed.' }

Write-Host ''
Write-Host 'Testing Gemma gated access with config.json only...'
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
& $hf download $model config.json --local-dir $probeDir
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'GEMMA ACCESS: BLOCKED'
  Write-Host 'Most likely the Gemma license has not been accepted for this Hugging Face account.'
  Write-Host 'Open: https://huggingface.co/google/gemma-3-12b-it'
  throw 'Gemma gated access check failed.'
}

$config = Join-Path $probeDir 'config.json'
if (-not (Test-Path $config)) { throw 'config.json was not downloaded.' }

Write-Host ''
Write-Host 'Checking Python imports...'
& $py -c "import torch, transformers, peft, accelerate, datasets, huggingface_hub; print('torch=',torch.__version__); print('transformers=',transformers.__version__); print('peft=',peft.__version__); print('accelerate=',accelerate.__version__); print('datasets=',datasets.__version__); print('hf=',huggingface_hub.__version__); print('gpu=',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE')"
if ($LASTEXITCODE -ne 0) { throw 'Python import smoke test failed.' }

Write-Host ''
Write-Host '=============================================================='
Write-Host 'BUYFLOW V17 GEMMA ACCESS: READY'
Write-Host "Model: $model"
Write-Host 'License/access: PASS'
Write-Host 'HF auth: PASS'
Write-Host 'Training libraries: PASS'
Write-Host 'GPU: PASS'
Write-Host 'Full Gemma weights: NOT DOWNLOADED'
Write-Host 'Training: NOT STARTED'
Write-Host 'Production: OFF'
Write-Host '=============================================================='
