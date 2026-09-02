param(
  [Parameter(Mandatory=$true)][string]$ReportDir
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$modelRoot=if($env:BUYFLOW_V11_MODEL_ROOT){$env:BUYFLOW_V11_MODEL_ROOT}else{Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'}
$distro='Ubuntu-24.04'
$tempRoot=Join-Path $env:TEMP ('buyflow-testlab-real120-' + [guid]::NewGuid().ToString('N'))
$idFile=Join-Path $tempRoot 'real120-ids.json'
$stdout=Join-Path $tempRoot 'eventmind.out.log'
$stderr=Join-Path $tempRoot 'eventmind.err.log'
$serverProcess=$null
$localDataTarget=Join-Path $repoRoot 'local-data'
$localDataJunction=$false

function Fail([string]$Message){throw $Message}
function Convert-ToWslPath([string]$p){
  $full=[IO.Path]::GetFullPath($p)
  if($full -notmatch '^([A-Za-z]):\\(.*)$'){Fail "WSL_PATH_UNSUPPORTED: $full"}
  $drive=$Matches[1].ToLowerInvariant(); $rest=$Matches[2].Replace('\','/')
  return "/mnt/$drive/$rest"
}
function Stop-Server {
  if($serverProcess){try{if(-not $serverProcess.HasExited){Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue}}catch{}}
  if(Get-Command wsl.exe -ErrorAction SilentlyContinue){& wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v11-runtime.py' || true" | Out-Null}
}
function Remove-Junction([string]$p){if(Test-Path -LiteralPath $p){cmd.exe /d /c "rmdir `"$p`"" | Out-Null}}

New-Item -ItemType Directory -Force -Path $tempRoot,$ReportDir | Out-Null
try {
  foreach($name in @('BUYFLOW_TESTLAB_GMAIL_CLIENT_ID','BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET','BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN','BUYFLOW_TESTLAB_REAL120_IDS_B64')){
    if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))){Fail "TESTLAB_SECRET_MISSING:$name"}
  }
  if(-not (Test-Path -LiteralPath (Join-Path $modelRoot 'local-data\lora-v11\LATEST.txt'))){Fail 'TESTLAB_V11_MODEL_NOT_FOUND'}
  if(-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)){Fail 'TESTLAB_WSL_NOT_FOUND'}

  $idBytes=[Convert]::FromBase64String($env:BUYFLOW_TESTLAB_REAL120_IDS_B64)
  [IO.File]::WriteAllBytes($idFile,$idBytes)
  $ids=Get-Content -Raw -LiteralPath $idFile | ConvertFrom-Json
  if(@($ids).Count -ne 120){Fail "TESTLAB_REAL120_EXPECTED_120_IDS_GOT_$(@($ids).Count)"}

  $tokenResponse=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
    client_id=$env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID
    client_secret=$env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET
    refresh_token=$env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN
    grant_type='refresh_token'
  } -TimeoutSec 30
  $accessToken=[string]$tokenResponse.access_token
  if([string]::IsNullOrWhiteSpace($accessToken)){Fail 'TESTLAB_GMAIL_TOKEN_REFRESH_FAILED'}

  if(-not (Test-Path -LiteralPath $localDataTarget)){
    $source=Join-Path $modelRoot 'local-data'
    cmd.exe /d /c "mklink /J `"$localDataTarget`" `"$source`"" | Out-Null
    if($LASTEXITCODE -ne 0){Fail 'TESTLAB_LOCAL_DATA_JUNCTION_FAILED'}
    $localDataJunction=$true
  }

  $server=Join-Path $repoRoot 'scripts\eventmind-v11-runtime.py'
  $wslProject=Convert-ToWslPath $repoRoot
  $wslServer=Convert-ToWslPath $server
  $wslHome=(& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
  if([string]::IsNullOrWhiteSpace($wslHome)){Fail 'TESTLAB_WSL_HOME_NOT_FOUND'}
  $wslPython="$wslHome/.venvs/buyflow-lora/bin/python"
  & wsl.exe -d $distro -- test -x $wslPython
  if($LASTEXITCODE -ne 0){Fail 'TESTLAB_LORA_PYTHON_NOT_FOUND'}

  Stop-Server
  $launchArgs=@('-d',$distro,'--','env','HSA_ENABLE_DXG_DETECTION=1','TOKENIZERS_PARALLELISM=false',$wslPython,$wslServer,$wslProject)
  $serverProcess=Start-Process -FilePath 'wsl.exe' -ArgumentList $launchArgs -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4394/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($serverProcess.HasExited){break}
    Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){if(Test-Path $stderr){Get-Content $stderr -Tail 30};Fail 'TESTLAB_EVENTMIND_RUNTIME_START_FAILED'}
  if($health.model_id -ne 'Qwen/Qwen3-8B' -or $health.thinking_enabled -ne $false -or $health.deterministic -ne $true){Fail 'TESTLAB_EVENTMIND_HEALTH_CONTRACT_FAILED'}

  $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
  $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED='true'
  $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4394/v1/eventmind'
  $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256=[string]$health.adapter_sha256
  $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='30000'

  $report=Join-Path $ReportDir 'eventmind-real120.json'
  Push-Location (Join-Path $repoRoot 'apps\api')
  try {
    & npm.cmd exec -- tsx 'src\scripts\eventmind-v11-real-gmail-blind120.ts' $idFile $report
    $exit=$LASTEXITCODE
  } finally {Pop-Location}
  if($exit -ne 0){Fail "TESTLAB_EVENTMIND_REAL120_EXIT_$exit"}

  Write-Host 'TESTLAB EVENTMIND REAL120: PASS' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ('TESTLAB EVENTMIND REAL120: BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  if(Test-Path $stderr){Get-Content $stderr -Tail 20}
  exit 1
} finally {
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS -ErrorAction SilentlyContinue
  Stop-Server
  if($localDataJunction){Remove-Junction $localDataTarget}
  if(Test-Path $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
}
