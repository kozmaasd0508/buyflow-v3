param(
  [Parameter(Mandatory=$true)][string]$IdFile,
  [Parameter(Mandatory=$true)][string]$ExpectedIdSha256
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$CodeCommit='e3b88c8e25056543f678927672c1a3a58ee3a34b'
$InnerUrl='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/e3b88c8e25056543f678927672c1a3a58ee3a34b/scripts/run-eventmind-v13-lite-real120-direct.ps1'
$temp=Join-Path $env:TEMP ('buyflow-v13-lite-direct-v2-' + [guid]::NewGuid().ToString('N') + '.ps1')

function Fail([string]$m){ throw $m }
function Is-BuyFlowRepo([string]$p){
  if(-not (Test-Path -LiteralPath $p)){return $false}
  $old=$ErrorActionPreference
  try{
    $ErrorActionPreference='SilentlyContinue'
    $remote=(& git.exe -C $p remote get-url origin 2>$null | Select-Object -First 1)
    return ([string]$remote -match 'kozmaasd0508[\\/]buyflow-v3(?:\.git)?$')
  }catch{return $false}
  finally{$ErrorActionPreference=$old}
}
function Find-RepoRoot{
  $known=@(
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runner\buyflow-v3'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\buyflow-v3')
  )
  foreach($p in $known){if(Is-BuyFlowRepo $p){return $p}}
  return $null
}
function Has-Commit([string]$repo,[string]$sha){
  $probe=& cmd.exe /d /c "git -C `"$repo`" cat-file -t $sha 2>nul"
  return ($LASTEXITCODE -eq 0 -and ([string]($probe | Select-Object -First 1)).Trim() -eq 'commit')
}

try{
  Write-Host ''
  Write-Host 'V13-LITE DIRECT V2 - kod ellenorzes...' -ForegroundColor Cyan
  if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){Fail 'GIT_NOT_FOUND'}
  $repo=Find-RepoRoot
  if(-not $repo){Fail 'BUYFLOW_GIT_REPOSITORY_NOT_FOUND'}

  if(-not (Has-Commit $repo $CodeCommit)){
    Write-Host 'A pontos V13-lite kod nincs meg helyben; letoltes GitHubrol...' -ForegroundColor Yellow
    $old=$ErrorActionPreference
    try{
      $ErrorActionPreference='Continue'
      & git.exe -C $repo fetch origin codex/buyflow-testlab-v1 2>&1 | Out-Host
      if($LASTEXITCODE -ne 0){Fail 'V13_LITE_CODE_FETCH_FAILED'}
    }finally{$ErrorActionPreference=$old}
  }
  if(-not (Has-Commit $repo $CodeCommit)){Fail 'EXACT_V13_LITE_COMMIT_NOT_AVAILABLE_AFTER_FETCH'}
  Write-Host 'Pontos V13-lite kod: OK' -ForegroundColor Green

  Invoke-WebRequest -UseBasicParsing -Uri $InnerUrl -OutFile $temp -TimeoutSec 30
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $temp -IdFile $IdFile -ExpectedIdSha256 $ExpectedIdSha256
  exit $LASTEXITCODE
}catch{
  Write-Host ''
  Write-Host ('V13-LITE DIRECT V2 BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  exit 1
}finally{
  if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
}
