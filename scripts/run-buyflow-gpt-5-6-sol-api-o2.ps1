$ErrorActionPreference = 'Stop'

Write-Host '=============================================================='
Write-Host 'BUYFLOW O2 - GPT-5.6 SOL API BENCHMARK'
Write-Host 'Uses OpenAI API only; local GPU training can continue in parallel.'
Write-Host 'Exact same pinned O2 cases as GPT-OSS/Gemma; aggregate-only.'
Write-Host 'Blind O3 NOT USED. Production OFF.'
Write-Host '=============================================================='
Write-Host ''

if (-not $env:OPENAI_API_KEY) {
  $sec = Read-Host 'OpenAI API key (input hidden)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw 'No API key provided.' }

$commit = '81635211bab61032a1d1a43e38f86c54e296dfc3'
$pyScript = Join-Path $env:TEMP 'run-buyflow-gpt-5-6-sol-api-o2.py'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$commit/scripts/run-buyflow-gpt-5-6-sol-api-o2.py" -OutFile $pyScript

# Use Windows Python without importing torch/ROCm, so this benchmark does not consume the training GPU.
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $python) { throw 'Python not found on PATH.' }

try {
  if ((Split-Path $python -Leaf).ToLower() -eq 'py.exe') {
    & $python -3 $pyScript
  } else {
    & $python $pyScript
  }
  if ($LASTEXITCODE -ne 0) { throw "GPT-5.6 Sol API O2 benchmark failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
}
