$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$predictCommit='6fbe5b7840c900be462f3232af4283f55847a1ca'
$predictUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$predictCommit/scripts/buyflow-real100-h2-prompt-v3-luna-diagnostic14.mjs"
$tempScript=Join-Path $env:TEMP ('buyflow-h2-v3-diagnostic-' + [guid]::NewGuid().ToString('N') + '.mjs')
$originalKey=$env:OPENAI_API_KEY

function Fail([string]$m){throw $m}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW H2 - LUNA PROMPT V3 DIAGNOSTIC 14' -ForegroundColor Cyan
  Write-Host 'H2 is SPENT diagnostic data now, not final blind accuracy.' -ForegroundColor Yellow
  Write-Host 'No Gmail calls. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  $node=(Get-Command node -ErrorAction SilentlyContinue)
  if(-not $node){Fail 'NODE_NOT_FOUND'}

  $preferred=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden\buyflow-real100-h2-v2\real100-h2-blind-bundle-maillens-v1.1-private-local.json'
  if(Test-Path -LiteralPath $preferred){
    $bundle=Get-Item -LiteralPath $preferred
  } else {
    $bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real100-h2-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if(-not $bundle){Fail 'REAL100_H2_BUNDLE_NOT_FOUND'}
  Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray

  $outPath=Join-Path $bundle.Directory.FullName 'real100-h2-prompt-v3-luna-diagnostic14.json'

  $secure=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if([string]::IsNullOrWhiteSpace($plain)){Fail 'OPENAI_API_KEY_EMPTY'}
  $env:OPENAI_API_KEY=$plain
  $plain=$null

  Invoke-WebRequest -UseBasicParsing -Uri $predictUrl -OutFile $tempScript -TimeoutSec 60
  & $node.Source $tempScript $bundle.FullName $outPath
  $exit=$LASTEXITCODE
  if($exit -ne 0){Fail "H2_V3_DIAGNOSTIC_EXIT_$exit"}
  if(-not (Test-Path -LiteralPath $outPath)){Fail 'H2_V3_DIAGNOSTIC_FILE_NOT_CREATED'}

  Write-Host ''
  Write-Host 'KESZ.' -ForegroundColor Green
  Write-Host 'Masold be ide a teljes konzol kimenetet, vagy toltsd fel ezt:' -ForegroundColor Cyan
  Write-Host ('  '+$outPath) -ForegroundColor Cyan
}
finally {
  if(Test-Path -LiteralPath $tempScript){Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalKey}
}
