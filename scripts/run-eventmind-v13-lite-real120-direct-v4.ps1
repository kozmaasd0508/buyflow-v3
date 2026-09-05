param(
  [Parameter(Mandatory=$true)][string]$IdFile,
  [Parameter(Mandatory=$true)][string]$ExpectedIdSha256
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$InnerUrl='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/6350b1ab7435b7c706010c167985f878d84294f6/scripts/run-eventmind-v13-lite-real120-direct.ps1'
$temp=Join-Path $env:TEMP ('buyflow-v13-lite-direct-v4-' + [guid]::NewGuid().ToString('N') + '.ps1')

try {
  Write-Host ''
  Write-Host 'V13-LITE DIRECT V4 - stabil regi mod...' -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing -Uri $InnerUrl -OutFile $temp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $temp

  # PowerShell 5 treats native stderr as ErrorRecord under ErrorActionPreference=Stop.
  # Route git through cmd.exe so normal git progress on stderr cannot abort a successful command.
  $oldRunGit=@'
function Run-Git([string[]]$Arguments){
  $out=& git.exe @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw ('GIT_FAILED: git ' + ($Arguments -join ' ') + "`n" + ($out -join "`n"))}
  return @($out)
}
'@
  $newRunGit=@'
function Run-Git([string[]]$Arguments){
  $quoted=@($Arguments | ForEach-Object { '"' + ([string]$_).Replace('"','\"') + '"' })
  $command='git.exe ' + ($quoted -join ' ') + ' 2>&1'
  $out=& cmd.exe /d /s /c $command
  $exit=$LASTEXITCODE
  if($exit -ne 0){throw ('GIT_FAILED: git ' + ($Arguments -join ' ') + "`n" + ($out -join "`n"))}
  return @($out)
}
'@
  if(-not $raw.Contains($oldRunGit)){throw 'PATCH_POINT_RUN_GIT_NOT_FOUND'}
  $raw=$raw.Replace($oldRunGit,$newRunGit)

  $oldCat="& git.exe -C `$repoRoot cat-file -e (`$CodeCommit + '^{commit}') 2>`$null"
  $newCat='& cmd.exe /d /c "git -C `"$repoRoot`" cat-file -e $CodeCommit^{commit} 2>nul" | Out-Null'
  $catCount=([regex]::Matches($raw,[regex]::Escape($oldCat))).Count
  if($catCount -lt 2){throw "PATCH_POINT_CAT_FILE_NOT_FOUND_OR_INCOMPLETE:$catCount"}
  $raw=$raw.Replace($oldCat,$newCat)

  [IO.File]::WriteAllText($temp,$raw,(New-Object Text.UTF8Encoding($false)))

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $temp -IdFile $IdFile -ExpectedIdSha256 $ExpectedIdSha256
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  Write-Host ('V13-LITE DIRECT V4 BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  exit 1
} finally {
  if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
