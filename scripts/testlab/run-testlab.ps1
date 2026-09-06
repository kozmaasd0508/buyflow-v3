param(
  [ValidateSet('full','eventmind','identity','core')][string]$Suite='full',
  [Parameter(Mandatory=$true)][string]$ReportDir
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$modelRoot=if($env:BUYFLOW_V11_MODEL_ROOT){$env:BUYFLOW_V11_MODEL_ROOT}else{Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'}
$privateRoot=if($env:BUYFLOW_TESTLAB_PRIVATE_ROOT){$env:BUYFLOW_TESTLAB_PRIVATE_ROOT}else{Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private'}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$stages=New-Object System.Collections.Generic.List[object]
$hardFailure=$false

function Add-Stage([string]$Name,[string]$Status,[string]$Detail,[int]$ExitCode=0){
  $script:stages.Add([ordered]@{name=$Name;status=$Status;detail=$Detail;exit_code=$ExitCode})
  if($Status -eq 'FAIL'){$script:hardFailure=$true}
  $color=if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'BLOCKED'){'Yellow'}else{'Red'}
  Write-Host ("[$Status] $Name - $Detail") -ForegroundColor $color
}

function Invoke-CommandStage([string]$Name,[scriptblock]$Command){
  try {
    & $Command
    $exit=$LASTEXITCODE
    if($null -eq $exit){$exit=0}
    if($exit -eq 0){Add-Stage $Name 'PASS' 'completed' 0}else{Add-Stage $Name 'FAIL' "exit $exit" $exit}
  } catch {
    Add-Stage $Name 'FAIL' $_.Exception.Message 1
  }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host "BUYFLOW TESTLAB - $Suite" -ForegroundColor Cyan
Write-Host 'Production flags remain OFF. TestLab never authorizes production cutover.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host ''

$required=@('node.exe','npm.cmd','git.exe','wsl.exe')
$missing=@($required | Where-Object {-not (Get-Command $_ -ErrorAction SilentlyContinue)})
if($missing.Count -gt 0){
  Add-Stage 'environment-preflight' 'FAIL' ('missing: ' + ($missing -join ', ')) 1
} else {
  Add-Stage 'environment-preflight' 'PASS' 'Node/npm/Git/WSL available' 0
}

if($Suite -in @('full','core','identity')){
  Push-Location $repoRoot
  try {
    Invoke-CommandStage 'api-typecheck' { npm.cmd run typecheck --workspace '@buyflow/api' }
    Invoke-CommandStage 'api-regression' { npm.cmd test --workspace '@buyflow/api' }
  } finally {Pop-Location}
}

if($Suite -in @('full','identity')){
  $stagingEnv=if($env:BUYFLOW_TESTLAB_STAGING_ENV_FILE){$env:BUYFLOW_TESTLAB_STAGING_ENV_FILE}else{Join-Path $modelRoot '.env.local'}
  if(Test-Path -LiteralPath $stagingEnv){
    Push-Location $repoRoot
    try {
      $old=$env:BUYFLOW_ENV_FILE
      $env:BUYFLOW_ENV_FILE=$stagingEnv
      Invoke-CommandStage 'trustlink-v9-real-gmail-shadow' { npm.cmd run identity:v9-real-gmail-shadow --workspace '@buyflow/api' }
      if($null -eq $old){Remove-Item Env:BUYFLOW_ENV_FILE -ErrorAction SilentlyContinue}else{$env:BUYFLOW_ENV_FILE=$old}
    } finally {Pop-Location}
  } else {
    Add-Stage 'trustlink-v9-real-gmail-shadow' 'BLOCKED' 'staging env file not configured on TestLab runner' 0
  }
  Add-Stage 'link120-ground-truth' 'BLOCKED' 'real-email chain ground truth dataset not frozen yet' 0
}

if($Suite -in @('full','eventmind')){
  $real120Ids=Join-Path $privateRoot 'real120-ids.json'
  if(-not (Test-Path -LiteralPath $real120Ids)){
    Add-Stage 'eventmind-real120' 'BLOCKED' ('local frozen id set not found: ' + $real120Ids) 0
  } elseif(-not (Test-Path -LiteralPath (Join-Path $modelRoot 'local-data\lora-v11\LATEST.txt'))){
    Add-Stage 'eventmind-real120' 'BLOCKED' 'local V11 model not found on runner' 0
  } else {
    & (Join-Path $PSScriptRoot 'run-eventmind-real120-local-oauth.ps1') -ReportDir $ReportDir
    $realExit=$LASTEXITCODE
    if($realExit -eq 0){Add-Stage 'eventmind-real120' 'PASS' '120 real Gmail predictions completed' 0}else{Add-Stage 'eventmind-real120' 'FAIL' "runner exit $realExit" $realExit}
  }
}

if($Suite -eq 'full'){
  Add-Stage 'rawvault-real-storage' 'BLOCKED' 'requires isolated Storage-capable Supabase test environment' 0
}

$pass=@($stages | Where-Object {$_.status -eq 'PASS'}).Count
$fail=@($stages | Where-Object {$_.status -eq 'FAIL'}).Count
$blocked=@($stages | Where-Object {$_.status -eq 'BLOCKED'}).Count
$overall=if($fail -gt 0){'FAIL'}elseif($blocked -gt 0){'PASS_WITH_BLOCKED_GATES'}else{'PASS'}

$report=[ordered]@{
  suite='BUYFLOW_TESTLAB_V1'
  requested_suite=$Suite
  created_at=(Get-Date).ToUniversalTime().ToString('o')
  git_sha=$env:GITHUB_SHA
  production_cutover_authorized=$false
  summary=[ordered]@{overall=$overall;pass=$pass;fail=$fail;blocked=$blocked}
  stages=$stages
}
$reportPath=Join-Path $ReportDir 'testlab-summary.json'
[IO.File]::WriteAllText($reportPath,($report | ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding($false)))

$lines=@(
  '# BuyFlow TestLab',
  '',
  "**Suite:** $Suite",
  "**Overall:** $overall",
  "**PASS:** $pass  |  **FAIL:** $fail  |  **BLOCKED:** $blocked",
  '',
  '| Stage | Status | Detail |',
  '|---|---|---|'
)
foreach($stage in $stages){
  $detail=([string]$stage.detail).Replace('|','/').Replace("`r",' ').Replace("`n",' ')
  $lines += "| $($stage.name) | $($stage.status) | $detail |"
}
$summaryText=$lines -join "`n"
Write-Host ''
Write-Host $summaryText
if($env:GITHUB_STEP_SUMMARY){Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summaryText -Encoding UTF8}

if($hardFailure){exit 2}
exit 0
