$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$predictCommit='070c1763695fe1396ab38e8a0a8770aee7490638'
$predictUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$predictCommit/scripts/buyflow-h2-prompt-v31-luna-regression13.mjs"
$tempScript=Join-Path $env:TEMP ('buyflow-h2-v31-' + [guid]::NewGuid().ToString('N') + '.mjs')
$originalKey=$env:OPENAI_API_KEY
function Fail([string]$m){throw $m}
try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW H2 - LUNA PROMPT V3.1 REGRESSION 13' -ForegroundColor Cyan
  Write-Host 'H2 is spent tuning data; this is NOT blind accuracy.' -ForegroundColor Yellow
  Write-Host 'No Gmail calls. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  $node=(Get-Command node -ErrorAction SilentlyContinue)
  if(-not $node){Fail 'NODE_NOT_FOUND'}
  $preferred=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden\buyflow-real100-h2-v2\real100-h2-blind-bundle-maillens-v1.1-private-local.json'
  if(Test-Path -LiteralPath $preferred){$bundle=Get-Item -LiteralPath $preferred}else{$bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real100-h2-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1}
  if(-not $bundle){Fail 'REAL100_H2_BUNDLE_NOT_FOUND'}
  Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray
  $outPath=Join-Path $bundle.Directory.FullName 'real100-h2-prompt-v31-luna-regression13.json'
  $secure=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if([string]::IsNullOrWhiteSpace($plain)){Fail 'OPENAI_API_KEY_EMPTY'}
  $env:OPENAI_API_KEY=$plain;$plain=$null
  Invoke-WebRequest -UseBasicParsing -Uri $predictUrl -OutFile $tempScript -TimeoutSec 60
  & $node.Source $tempScript $bundle.FullName $outPath
  $exit=$LASTEXITCODE
  if($exit -ne 0){Fail "H2_V31_EXIT_$exit"}
  if(-not (Test-Path -LiteralPath $outPath)){Fail 'H2_V31_RESULT_NOT_CREATED'}
  Write-Host ''
  Write-Host 'KESZ. Masold be a konzol kimenetet vagy toltsd fel:' -ForegroundColor Green
  Write-Host ('  '+$outPath) -ForegroundColor Cyan
}
finally {
  if(Test-Path -LiteralPath $tempScript){Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalKey}
}
