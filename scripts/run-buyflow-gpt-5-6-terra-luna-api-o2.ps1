$ErrorActionPreference = 'Stop'

Write-Host '=============================================================='
Write-Host 'BUYFLOW O2 - GPT-5.6 TERRA + LUNA API BENCHMARK'
Write-Host 'Same pinned 40 O2 cases as Sol/GPT-OSS/Gemma.'
Write-Host 'reasoning=low | structured outputs | aggregate-only'
Write-Host 'Blind O3 NOT USED. Production OFF.'
Write-Host 'Local GPU training may continue in parallel.'
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

$baseCommit = '81635211bab61032a1d1a43e38f86c54e296dfc3'
$baseScript = Join-Path $env:TEMP 'run-buyflow-gpt-5-6-sol-api-o2-base.py'
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-buyflow-gpt-5-6-sol-api-o2.py" -OutFile $baseScript
$base = Get-Content -Raw -Encoding UTF8 $baseScript

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $python) { throw 'Python not found on PATH.' }

$models = @(
  @{ Name = 'gpt-5.6-terra'; Input = '2.0'; Output = '12.0' },
  @{ Name = 'gpt-5.6-luna';  Input = '0.2'; Output = '1.2' }
)

try {
  foreach ($m in $models) {
    $name = $m.Name
    $safe = $name.Replace('.', '-').Replace(':', '-')
    $scriptPath = Join-Path $env:TEMP ("run-buyflow-{0}-api-o2.py" -f $safe)

    $src = $base
    $src = $src.Replace('MODEL = "gpt-5.6-sol"', ('MODEL = "{0}"' -f $name))
    $src = $src.Replace('buyflow-o2-gpt-5-6-sol-api', ('buyflow-o2-{0}-api' -f $safe))
    $src = $src.Replace('buyflow-o2-extension-gpt-5-6-sol-api', ('buyflow-o2-extension-{0}-api' -f $safe))
    $src = $src.Replace('total_in / 1_000_000 * 4.0 + total_out / 1_000_000 * 20.0', ('total_in / 1_000_000 * {0} + total_out / 1_000_000 * {1}' -f $m.Input, $m.Output))
    $src = $src.Replace('GPT-5.6 SOL', $name.ToUpper())

    Set-Content -Path $scriptPath -Value $src -Encoding UTF8

    Write-Host ''
    Write-Host '=============================================================='
    Write-Host ("STARTING {0} ON PINNED O2" -f $name.ToUpper())
    Write-Host '=============================================================='

    if ((Split-Path $python -Leaf).ToLower() -eq 'py.exe') {
      & $python -3 $scriptPath
    } else {
      & $python $scriptPath
    }
    if ($LASTEXITCODE -ne 0) { throw "$name O2 benchmark failed with exit code $LASTEXITCODE" }
  }
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '=============================================================='
Write-Host 'TERRA + LUNA O2 BENCHMARKS COMPLETE'
Write-Host 'Compare against Sol: EXACT 36/40 = 90.0%'
Write-Host 'Blind O3 NOT USED. Production OFF.'
Write-Host '=============================================================='
