$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$predictCommit='ec5e8449e4dfdaa5f9ce8f9d7fc73f3ceab65609'
$predictUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$predictCommit/scripts/buyflow-real60-h1-maillens-v11-prompt-v2-predict.mjs"
$tempScript=Join-Path $env:TEMP ('buyflow-h1-v11-predict-' + [guid]::NewGuid().ToString('N') + '.mjs')
$originalKey=$env:OPENAI_API_KEY

function Fail([string]$m){throw $m}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL60 H1 - MAILLENS v1.1 + FROZEN PROMPT V2' -ForegroundColor Cyan
  Write-Host 'Luna + Terra + Sol | prediction only' -ForegroundColor Green
  Write-Host 'No Gmail calls. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  $node=(Get-Command node -ErrorAction SilentlyContinue)
  if(-not $node){Fail 'NODE_NOT_FOUND'}

  $bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real60-h1-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(-not $bundle){Fail 'MAILLENS_V11_H1_BUNDLE_NOT_FOUND'}
  Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray

  $outPath=Join-Path $bundle.Directory.FullName 'real60-h1-maillens-v1.1-prompt-v2-predictions-private-local.json'

  $secure=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if([string]::IsNullOrWhiteSpace($plain)){Fail 'OPENAI_API_KEY_EMPTY'}
  $env:OPENAI_API_KEY=$plain
  $plain=$null

  Invoke-WebRequest -UseBasicParsing -Uri $predictUrl -OutFile $tempScript -TimeoutSec 60
  & $node.Source $tempScript $bundle.FullName $outPath
  $exit=$LASTEXITCODE
  if($exit -ne 0){Fail "PREDICT_EXIT_$exit"}
  if(-not (Test-Path -LiteralPath $outPath)){Fail 'PREDICTIONS_FILE_NOT_CREATED'}

  Write-Host ''
  Write-Host 'KESZ.' -ForegroundColor Green
  Write-Host 'Toltsd fel ide ezt az egy fajlt:' -ForegroundColor Cyan
  Write-Host ('  '+$outPath) -ForegroundColor Cyan
}
finally {
  if(Test-Path -LiteralPath $tempScript){Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalKey}
}
