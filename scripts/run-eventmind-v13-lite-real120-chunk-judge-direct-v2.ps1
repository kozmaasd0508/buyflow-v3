param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$baseCommit='e3ff5a29e0c0bc8c9074c3ba22f07c6d58e6bda6'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-real120-chunk-judge-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-real120-chunk-judge-v2-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-real120-chunk-judge-v2-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND REAL120 CHUNK + FINAL JUDGE DIRECT V2' -ForegroundColor Cyan
  Write-Host 'POWERSHELL PARSER FIX / CHECKPOINT / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp

  $bad='Write-Host ("--- SEGMENT $segment: Gmail token frissites + tiszta Qwen ---") -ForegroundColor Cyan'
  $good='Write-Host ("--- SEGMENT ${segment}: Gmail token frissites + tiszta Qwen ---") -ForegroundColor Cyan'
  if(-not $text.Contains($bad)){throw 'EXPECTED_SEGMENT_INTERPOLATION_NOT_FOUND'}
  $text=$text.Replace($bad,$good)

  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
