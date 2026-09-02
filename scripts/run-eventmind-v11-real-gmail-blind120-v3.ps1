param(
  [Parameter(Mandatory=$true)][string]$IdFile,
  [Parameter(Mandatory=$true)][string]$ExpectedIdSha256
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$V2Url='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/c090b47fd408e4904df6e3a1d65ca0870fb36825/scripts/run-eventmind-v11-real-gmail-blind120-v2.ps1'
$temp=Join-Path $env:TEMP ('buyflow-blind120-v3-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Invoke-WebRequest -UseBasicParsing -Uri $V2Url -OutFile $temp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $temp

  $old1='function Run-Git([string[]]$args){'
  $new1='function Run-Git([string[]]$Arguments){'
  $old2='$out=& git.exe @args 2>&1'
  $new2='$out=& git.exe @Arguments 2>&1'

  if(-not $raw.Contains($old1)){ throw 'PATCH_POINT_RUN_GIT_SIGNATURE_NOT_FOUND' }
  if(-not $raw.Contains($old2)){ throw 'PATCH_POINT_RUN_GIT_CALL_NOT_FOUND' }

  $raw=$raw.Replace($old1,$new1)
  $raw=$raw.Replace($old2,$new2)
  [IO.File]::WriteAllText($temp,$raw,(New-Object Text.UTF8Encoding($false)))

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $temp -IdFile $IdFile -ExpectedIdSha256 $ExpectedIdSha256
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  Write-Host ('BLIND120 V3 PATCH BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  exit 1
} finally {
  if(Test-Path -LiteralPath $temp){ Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
