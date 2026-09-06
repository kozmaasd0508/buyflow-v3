param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$baseCommit='bf400677e1a28427336d57f476b3045970541699'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-chunk45-diagnostic-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-chunk45-judge-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-chunk45-judge-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND - CHUNK45 + FINAL JUDGE DIRECT' -ForegroundColor Cyan
  Write-Host 'REAL120 INDEX 45 -> CHUNKS -> SHORT EVIDENCE -> FINAL JUDGE' -ForegroundColor Cyan
  Write-Host 'NINCS TESTLAB / NINCS GITHUB RUNNER / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp
  $text=$text.Replace('eventmind-v13-real-gmail-chunk45-diagnostic.ts','eventmind-v13-real-gmail-chunk45-judge-diagnostic.ts')
  $text=$text.Replace('BuyFlow-EVENTMIND-CHUNK45-DIAGNOSTIC-','BuyFlow-EVENTMIND-CHUNK45-JUDGE-DIAGNOSTIC-')
  $text=$text.Replace('BuyFlow-EVENTMIND-CHUNK45-GPU-','BuyFlow-EVENTMIND-CHUNK45-JUDGE-GPU-')
  $text=$text.Replace('BuyFlow-EVENTMIND-CHUNK45-RUNTIME-OUT-','BuyFlow-EVENTMIND-CHUNK45-JUDGE-RUNTIME-OUT-')
  $text=$text.Replace('BuyFlow-EVENTMIND-CHUNK45-RUNTIME-ERR-','BuyFlow-EVENTMIND-CHUNK45-JUDGE-RUNTIME-ERR-')
  $text=$text.Replace('REAL120 index 45 CHUNK diagnosztika...','REAL120 index 45 CHUNK + FINAL JUDGE diagnosztika...')
  $text=$text.Replace('CHUNK45 DIAGNOSTIC: CAPTURED','CHUNK45 JUDGE DIAGNOSTIC: CAPTURED')
  $text=$text.Replace('CHUNK45 DIAGNOSTIC BLOCKED/FAIL','CHUNK45 JUDGE DIAGNOSTIC BLOCKED/FAIL')
  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
