param(
  [Parameter(Mandatory=$true)][string]$ReportDir
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$privateRoot=if($env:BUYFLOW_TESTLAB_PRIVATE_ROOT){$env:BUYFLOW_TESTLAB_PRIVATE_ROOT}else{Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private'}
$idFile=Join-Path $privateRoot 'real120-ids.json'
$expectedIdSha='88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470'
$distro='Ubuntu-24.04'
$tempRoot=Join-Path $env:TEMP ('buyflow-testlab-v14-base-' + [guid]::NewGuid().ToString('N'))
$stdout=Join-Path $tempRoot 'eventmind-v14-base.out.log'
$stderr=Join-Path $tempRoot 'eventmind-v14-base.err.log'
$serverProcess=$null

function Fail([string]$Message){throw $Message}
function Get-Sha256Text([string]$Text){
  $sha=[Security.Cryptography.SHA256]::Create()
  try {
    $bytes=[Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()
  } finally {$sha.Dispose()}
}
function Convert-ToWslPath([string]$p){
  $full=[IO.Path]::GetFullPath($p)
  if($full -notmatch '^([A-Za-z]):\\(.*)$'){Fail "WSL_PATH_UNSUPPORTED: $full"}
  $drive=$Matches[1].ToLowerInvariant(); $rest=$Matches[2].Replace('\','/')
  return "/mnt/$drive/$rest"
}
function Stop-Server {
  if($serverProcess){try{if(-not $serverProcess.HasExited){Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue}}catch{}}
  if(Get-Command wsl.exe -ErrorAction SilentlyContinue){& wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v14-base-runtime.py' || true" | Out-Null}
}

New-Item -ItemType Directory -Force -Path $tempRoot,$ReportDir | Out-Null
try {
  foreach($name in @('BUYFLOW_TESTLAB_GMAIL_CLIENT_ID','BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET','BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN')){
    if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))){Fail "TESTLAB_SECRET_MISSING:$name"}
  }
  if(-not (Test-Path -LiteralPath $idFile)){Fail "TESTLAB_REAL120_IDS_MISSING:$idFile"}
  $ids=Get-Content -Raw -LiteralPath $idFile | ConvertFrom-Json
  if(@($ids).Count -ne 120){Fail "TESTLAB_REAL120_EXPECTED_120_IDS_GOT_$(@($ids).Count)"}
  $canonical=[string]::Join("`n",[string[]]$ids)
  $actualIdSha=Get-Sha256Text $canonical
  if($actualIdSha -ne $expectedIdSha){Fail "TESTLAB_REAL120_SHA_MISMATCH:$actualIdSha"}
  Write-Host ("Frozen REAL120 SHA256: " + $actualIdSha) -ForegroundColor Green

  if(-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)){Fail 'TESTLAB_WSL_NOT_FOUND'}
  $wslHome=(& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
  if([string]::IsNullOrWhiteSpace($wslHome)){Fail 'TESTLAB_WSL_HOME_NOT_FOUND'}
  $wslPython="$wslHome/.venvs/buyflow-lora/bin/python"
  & wsl.exe -d $distro -- test -x $wslPython
  if($LASTEXITCODE -ne 0){Fail 'TESTLAB_AI_PYTHON_NOT_FOUND'}

  $tokenResponse=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
    client_id=$env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID
    client_secret=$env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET
    refresh_token=$env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN
    grant_type='refresh_token'
  } -TimeoutSec 30
  $accessToken=[string]$tokenResponse.access_token
  if([string]::IsNullOrWhiteSpace($accessToken)){Fail 'TESTLAB_GMAIL_TOKEN_REFRESH_FAILED'}

  $server=Join-Path $repoRoot 'scripts\eventmind-v14-base-runtime.py'
  $wslServer=Convert-ToWslPath $server
  Stop-Server
  $launchArgs=@('-d',$distro,'--','env','HSA_ENABLE_DXG_DETECTION=1','TOKENIZERS_PARALLELISM=false',$wslPython,$wslServer,'--port','4395')
  $serverProcess=Start-Process -FilePath 'wsl.exe' -ArgumentList $launchArgs -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru

  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4395/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($serverProcess.HasExited){break}
    Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){if(Test-Path $stderr){Get-Content $stderr -Tail 30};Fail 'TESTLAB_EVENTMIND_V14_BASE_RUNTIME_START_FAILED'}
  if(
    $health.model_id -ne 'Qwen/Qwen3-8B' -or
    $null -ne $health.adapter -or
    $health.template_version -ne 'qwen3-system-user-thinking-off-v1' -or
    $health.thinking_enabled -ne $false -or
    $health.deterministic -ne $true
  ){Fail 'TESTLAB_EVENTMIND_V14_BASE_HEALTH_CONTRACT_FAILED'}

  $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
  $env:BUYFLOW_EVENTMIND_V14_BASE_RUNTIME_URL='http://127.0.0.1:4395/v1/eventmind'

  Write-Host 'Running V14 prompt unit gate...' -ForegroundColor Cyan
  Push-Location (Join-Path $repoRoot 'apps\api')
  try {
    & node.exe --import tsx --test 'src\ai\eventmind-v14-zero-shot.test.ts'
    if($LASTEXITCODE -ne 0){Fail "TESTLAB_EVENTMIND_V14_UNIT_GATE_EXIT_$LASTEXITCODE"}

    $report=Join-Path $ReportDir 'eventmind-v14-base-real120-dev.json'
    & npm.cmd exec -- tsx 'src\scripts\eventmind-v14-real-gmail-dev120.ts' $idFile $report
    $exit=$LASTEXITCODE
  } finally {Pop-Location}
  if($exit -ne 0){Fail "TESTLAB_EVENTMIND_V14_BASE_DEV120_EXIT_$exit"}

  Write-Host 'TESTLAB EVENTMIND V14 BASE REAL120 DEV: COMPLETE' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ('TESTLAB EVENTMIND V14 BASE REAL120 DEV: BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  if(Test-Path $stderr){Get-Content $stderr -Tail 20}
  exit 1
} finally {
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V14_BASE_RUNTIME_URL -ErrorAction SilentlyContinue
  Stop-Server
  if(Test-Path $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
}
