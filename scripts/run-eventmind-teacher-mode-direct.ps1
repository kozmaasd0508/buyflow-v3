param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Reuse the proven DIRECT Gmail OAuth + local Qwen harness. The harness itself
# fetches the current codex/buyflow-testlab-v1 branch into an isolated worktree.
$baseCommit='0792a897e92e48fb10102647a7ba90e4cde4bcab'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-real5-diagnostic-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-teacher-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-teacher-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND - INTERACTIVE TEACHER MODE V1' -ForegroundColor Cyan
  Write-Host 'REAL120 DEVELOPMENT ERRORS / LOCAL QWEN / DIRECT' -ForegroundColor Cyan
  Write-Host 'GMAIL GET-ONLY / PRODUCTION OFF' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp
  $text=$text.Replace('eventmind-v13-real-gmail-diagnostic5.ts','eventmind-teacher-mode-v1.ts')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-DIAGNOSTIC-','BuyFlow-TEACHER-SUMMARY-')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-GPU-','BuyFlow-TEACHER-GPU-')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-RUNTIME-OUT-','BuyFlow-TEACHER-RUNTIME-OUT-')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL5-RUNTIME-ERR-','BuyFlow-TEACHER-RUNTIME-ERR-')
  $text=$text.Replace('BUYFLOW EVENTMIND - REAL5 GPU DIAGNOSTIC','BUYFLOW EVENTMIND - INTERACTIVE TEACHER MODE V1')
  $text=$text.Replace('FROZEN REAL120 INDEX 43-47 / STOP ON FIRST TIMEOUT','REAL120 DEVELOPMENT ERRORS / ACTIVE LEARNING')
  $text=$text.Replace('[4/4] REAL120 index 43-47 diagnosztika...','[4/4] Interaktiv Teacher Mode indul...')
  $text=$text.Replace('Timeout = 20 sec. Elso timeout utan AZONNAL LEALL.','AI valaszonkent timeout = 20 sec. Ures ENTER = javasolt tanari uzenet.')
  $text=$text.Replace('REAL5 DIAGNOSTIC: CAPTURED','TEACHER MODE: SESSION CLOSED')
  $text=$text.Replace('REAL5 DIAGNOSTIC BLOCKED/FAIL','TEACHER MODE BLOCKED/FAIL')
  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
