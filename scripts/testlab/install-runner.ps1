param(
  [string]$RunnerRoot='C:\actions-runner-buyflow'
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repoUrl='https://github.com/kozmaasd0508/buyflow-v3'
$runnerName=('buyflow-testlab-' + $env:COMPUTERNAME).ToLowerInvariant()
$taskName='BuyFlow TestLab Runner'

function Fail([string]$Message){throw $Message}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW TESTLAB - ONE-TIME SELF-HOSTED RUNNER SETUP' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'This registers this Windows PC only for the BuyFlow GitHub repository.' -ForegroundColor Green
Write-Host 'The runner will use the custom label: buyflow-testlab' -ForegroundColor Green
Write-Host ''

if(-not [Environment]::Is64BitOperatingSystem){Fail 'TESTLAB_REQUIRES_WINDOWS_X64'}
if(-not (Get-Command powershell.exe -ErrorAction SilentlyContinue)){Fail 'POWERSHELL_NOT_FOUND'}

$secureToken=Read-Host 'Paste the temporary GitHub runner registration token' -AsSecureString
$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$token=$null
try {
  $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if([string]::IsNullOrWhiteSpace($token)){Fail 'EMPTY_REGISTRATION_TOKEN'}

  if(Test-Path -LiteralPath (Join-Path $RunnerRoot '.runner')){
    Write-Host 'A runner is already configured in this folder.' -ForegroundColor Yellow
    Write-Host "Runner root: $RunnerRoot"
    exit 0
  }

  New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
  $release=Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers @{Accept='application/vnd.github+json';'User-Agent'='BuyFlow-TestLab'} -TimeoutSec 30
  $asset=@($release.assets | Where-Object {$_.name -match '^actions-runner-win-x64-.*\.zip$'} | Select-Object -First 1)
  if(-not $asset){Fail 'WINDOWS_X64_RUNNER_ASSET_NOT_FOUND'}
  $zip=Join-Path $env:TEMP $asset.name

  Write-Host ("Downloading GitHub Actions runner " + $release.tag_name + '...') -ForegroundColor Yellow
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zip -TimeoutSec 120
  Expand-Archive -LiteralPath $zip -DestinationPath $RunnerRoot -Force
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

  Push-Location $RunnerRoot
  try {
    & .\config.cmd --unattended --url $repoUrl --token $token --name $runnerName --labels buyflow-testlab --work _work --replace
    if($LASTEXITCODE -ne 0){Fail "RUNNER_CONFIG_FAILED:$LASTEXITCODE"}
  } finally {Pop-Location}

  $runCmd=Join-Path $RunnerRoot 'run.cmd'
  $action=New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/d /c "' + $runCmd + '"')
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN + '\' + $env:USERNAME)
  $principal=New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN + '\' + $env:USERNAME) -LogonType Interactive -RunLevel Limited
  try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Host 'Runner scheduled task: CREATED + STARTED' -ForegroundColor Green
  } catch {
    Write-Host ('Scheduled task could not be created automatically: ' + $_.Exception.Message) -ForegroundColor Yellow
    Write-Host 'Starting the runner interactively instead.' -ForegroundColor Yellow
    Start-Process -FilePath $runCmd -WorkingDirectory $RunnerRoot
  }

  Write-Host ''
  Write-Host 'BUYFLOW TESTLAB RUNNER: REGISTERED' -ForegroundColor Green
  Write-Host "Runner name: $runnerName"
  Write-Host "Runner root: $RunnerRoot"
  Write-Host 'The queued TestLab core bootstrap job can now be picked up by this PC.' -ForegroundColor Green
} finally {
  if($bstr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  $token=$null
}
