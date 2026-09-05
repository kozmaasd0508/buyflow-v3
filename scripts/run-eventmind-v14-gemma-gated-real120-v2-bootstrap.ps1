param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Literal source-code placeholders consumed by the single-layer patcher.
$branch='$branch'
$repoRoot='$repoRoot'

$runnerCommit='ae237feaf910932ef45be40b8979c1f492775ba2'
$url="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/run-eventmind-v14-gemma-gated-real120-direct-v2.ps1"
$tmp=Join-Path $env:TEMP ('buyflow-v14-v2-' + [guid]::NewGuid().ToString('N') + '.ps1')
try {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp -TimeoutSec 30

  # The original harness cleanup still removes an old V11 env name; that is harmless.
  # The safety guard should reject only an active attempt to read health.adapter_sha256.
  $raw=Get-Content -Raw -LiteralPath $tmp
  $old=@'
  if($text -match '\$health\.adapter_sha256' -or $text -match 'BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256'){
'@
  $new=@'
  if($text -match '\$health\.adapter_sha256'){
'@
  if(-not $raw.Contains($old)){throw 'EXPECTED_V2_GUARD_NOT_FOUND'}
  $raw=$raw.Replace($old,$new)
  Set-Content -LiteralPath $tmp -Value $raw -Encoding UTF8

  . $tmp -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
