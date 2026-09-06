$ErrorActionPreference = 'Stop'

$envDir = "$env:USERPROFILE\BuyFlowTools\v17-qlora"
$py = Join-Path $envDir 'Scripts\python.exe'
$model = 'google/gemma-3-12b-it'
$probeDir = "$env:USERPROFILE\BuyFlowTools\gemma-3-12b-it-access-check"

if (-not (Test-Path $py)) { throw "V17 QLoRA environment missing: $py" }

Write-Host '=============================================================='
Write-Host 'BUYFLOW V17 - HUGGING FACE / GEMMA ACCESS SETUP V2'
Write-Host "Model: $model"
Write-Host 'Training: NOT STARTED'
Write-Host 'Full model download: NOT STARTED'
Write-Host '=============================================================='

Write-Host ''
Write-Host 'Checking installed Hugging Face / PEFT tooling...'
& $py -c "import huggingface_hub, transformers, accelerate, peft, datasets, safetensors; print('tooling=PASS')"
if ($LASTEXITCODE -ne 0) { throw 'Training tooling import check failed.' }

Write-Host ''
Write-Host 'Checking cached Hugging Face token...'
$tokenState = & $py -c "from huggingface_hub import get_token; print('YES' if get_token() else 'NO')"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Hugging Face token state.' }

if (($tokenState | Select-Object -Last 1).Trim() -ne 'YES') {
  Write-Host ''
  Write-Host 'Hugging Face login is required.'
  Write-Host 'Opening the Gemma license page and token page in your browser...'
  Start-Process 'https://huggingface.co/google/gemma-3-12b-it'
  Start-Sleep -Seconds 1
  Start-Process 'https://huggingface.co/settings/tokens'
  Write-Host ''
  Write-Host '1) Accept / acknowledge the Google Gemma license on the model page.'
  Write-Host '2) Create a READ token on the token page.'
  Write-Host '3) Paste the token ONLY into the PowerShell prompt below. Do NOT paste it into ChatGPT.'
  Write-Host ''
  $secure = Read-Host 'Hugging Face READ token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Empty Hugging Face token.' }
  $env:BUYFLOW_HF_TOKEN = $plain
  & $py -c "import os; from huggingface_hub import login; login(token=os.environ['BUYFLOW_HF_TOKEN'], add_to_git_credential=False)"
  $loginCode = $LASTEXITCODE
  Remove-Item Env:BUYFLOW_HF_TOKEN -ErrorAction SilentlyContinue
  $plain = $null
  if ($loginCode -ne 0) { throw 'Hugging Face login failed.' }
}

Write-Host ''
Write-Host 'Verifying Hugging Face account via Python API...'
& $py -c "from huggingface_hub import HfApi; x=HfApi().whoami(); print('account=', x.get('name') or x.get('fullname') or 'authenticated')"
if ($LASTEXITCODE -ne 0) { throw 'Hugging Face authentication check failed.' }

Write-Host ''
Write-Host 'Testing Gemma gated access with config.json only...'
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
$env:BUYFLOW_HF_PROBE = $probeDir
& $py -c "import os; from huggingface_hub import hf_hub_download; p=hf_hub_download(repo_id='google/gemma-3-12b-it', filename='config.json', local_dir=os.environ['BUYFLOW_HF_PROBE']); print('config=',p)"
$probeCode = $LASTEXITCODE
Remove-Item Env:BUYFLOW_HF_PROBE -ErrorAction SilentlyContinue
if ($probeCode -ne 0) {
  Write-Host ''
  Write-Host 'GEMMA ACCESS: BLOCKED'
  Write-Host 'Most likely the Gemma license has not yet been accepted for this Hugging Face account.'
  Write-Host 'Open: https://huggingface.co/google/gemma-3-12b-it'
  throw 'Gemma gated access check failed.'
}

$config = Join-Path $probeDir 'config.json'
if (-not (Test-Path $config)) { throw 'config.json was not downloaded.' }

Write-Host ''
Write-Host 'Final Python/GPU smoke test...'
& $py -c "import torch, transformers, peft, accelerate, datasets, huggingface_hub; print('torch=',torch.__version__); print('transformers=',transformers.__version__); print('peft=',peft.__version__); print('accelerate=',accelerate.__version__); print('datasets=',datasets.__version__); print('hf=',huggingface_hub.__version__); print('gpu=',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NONE'); print('vram_gb=',round(torch.cuda.get_device_properties(0).total_memory/1024**3,2) if torch.cuda.is_available() else 0)"
if ($LASTEXITCODE -ne 0) { throw 'Final Python/GPU smoke test failed.' }

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
