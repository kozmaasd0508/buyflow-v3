param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$codeCommit='a61843c9e80a1c29582805e6e2f909595d855749'
$baseCommit='e3ff5a29e0c0bc8c9074c3ba22f07c6d58e6bda6'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-real120-chunk-judge-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-prompt-v4-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-prompt-v4-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND - REAL120 PROMPT V4 DECISION-GATE TEST' -ForegroundColor Cyan
  Write-Host 'PINNED CODE / DIRECT / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ('Expected code commit: ' + $codeCommit) -ForegroundColor Green
  Write-Host 'REAL120 = development set. Gmail GET-only.' -ForegroundColor Green
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp

  $parserBad='Write-Host ("--- SEGMENT $segment: Gmail token frissites + tiszta Qwen ---") -ForegroundColor Cyan'
  $parserGood='Write-Host ("--- SEGMENT ${segment}: Gmail token frissites + tiszta Qwen ---") -ForegroundColor Cyan'
  if(-not $text.Contains($parserBad)){throw 'EXPECTED_SEGMENT_INTERPOLATION_NOT_FOUND'}
  $text=$text.Replace($parserBad,$parserGood)

  $pinNeedle='if($fetched -notmatch ''^[a-f0-9]{40}$''){Fail "FETCH_HEAD_INVALID:$fetched"}'
  $pinReplacement=$pinNeedle + "`r`n  if(`$fetched -ne '$codeCommit'){Fail \"PINNED_CODE_MISMATCH:`$fetched\"}"
  if(-not $text.Contains($pinNeedle)){throw 'EXPECTED_FETCH_HEAD_GUARD_NOT_FOUND'}
  $text=$text.Replace($pinNeedle,$pinReplacement)

  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-PROMPT-V4-CHECKPOINT.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-$stamp.json','BuyFlow-EVENTMIND-REAL120-PROMPT-V4-$stamp.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-GPU-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-PROMPT-V4-GPU-$stamp.jsonl')

  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
