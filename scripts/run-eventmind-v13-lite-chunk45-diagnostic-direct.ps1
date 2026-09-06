param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$baseCommit='0792a897e92e48fb10102647a7ba90e4cde4bcab'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-real5-diagnostic-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-chunk45-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-chunk45-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND - CHUNK45 DIRECT DIAGNOSTIC' -ForegroundColor Cyan
  Write-Host 'REAL120 INDEX 45 -> 3000 CHAR CHUNKS / 250 CHAR OVERLAP' -ForegroundColor Cyan
  Write-Host 'NINCS TESTLAB / NINCS GITHUB RUNNER / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp
  $text=$text.Replace('eventmind-v13-real-gmail-diagnostic5.ts','eventmind-v13-real-gmail-chunk45-diagnostic.ts')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-DIAGNOSTIC-','BuyFlow-EVENTMIND-CHUNK45-DIAGNOSTIC-')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-GPU-','BuyFlow-EVENTMIND-CHUNK45-GPU-')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-RUNTIME-OUT-','BuyFlow-EVENTMIND-CHUNK45-RUNTIME-OUT-')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-RUNTIME-ERR-','BuyFlow-EVENTMIND-CHUNK45-RUNTIME-ERR-')
  $text=$text.Replace('[4/4] REAL120 index 43-47 diagnosztika...','[4/4] REAL120 index 45 CHUNK diagnosztika...')
  $text=$text.Replace('Timeout = 20 sec. Elso timeout utan AZONNAL LEALL.','Chunk max 3000 karakter, 250 karakter atfedes. Timeout = 20 sec.')
  $text=$text.Replace('REAL5 DIAGNOSTIC: CAPTURED','CHUNK45 DIAGNOSTIC: CAPTURED')
  $text=$text.Replace('REAL5 DIAGNOSTIC BLOCKED/FAIL','CHUNK45 DIAGNOSTIC BLOCKED/FAIL')
  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
