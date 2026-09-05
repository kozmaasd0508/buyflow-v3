param(
  [Parameter(Mandatory=$true)][string]$IdFile,
  [Parameter(Mandatory=$true)][string]$ExpectedIdSha256
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$InnerUrl='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/6350b1ab7435b7c706010c167985f878d84294f6/scripts/run-eventmind-v13-lite-real120-direct.ps1'
$temp=Join-Path $env:TEMP ('buyflow-v13-lite-direct-v3-' + [guid]::NewGuid().ToString('N') + '.ps1')

try{
  Write-Host ''
  Write-Host 'V13-LITE DIRECT V3 - stabil regi mod...' -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing -Uri $InnerUrl -OutFile $temp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $temp

  $old="& git.exe -C `$repoRoot cat-file -e (`$CodeCommit + '^{commit}') 2>`$null"
  $new='& cmd.exe /d /c "git -C `"$repoRoot`" cat-file -e $CodeCommit^{commit} 2>nul" | Out-Null'
  $count=([regex]::Matches($raw,[regex]::Escape($old))).Count
  if($count -lt 2){throw "PATCH_POINT_CAT_FILE_NOT_FOUND_OR_INCOMPLETE:$count"}
  $raw=$raw.Replace($old,$new)
  [IO.File]::WriteAllText($temp,$raw,(New-Object Text.UTF8Encoding($false)))

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $temp -IdFile $IdFile -ExpectedIdSha256 $ExpectedIdSha256
  exit $LASTEXITCODE
}catch{
  Write-Host ''
  Write-Host ('V13-LITE DIRECT V3 BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  exit 1
}finally{
  if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
