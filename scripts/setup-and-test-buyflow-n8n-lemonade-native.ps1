$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$expectedN8nVersion='2.37.3'
$lemonadeBase='http://127.0.0.1:13305/v1'
$expectedModel='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$credentialId='BFLemonadeCred1'
$workflowId='BFLemonadeSmoke1'
$assetCommit='2e8f5d82c2926fd9ad1a73dba9b6fd3c3a2453bd'
$repoRaw='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/'+$assetCommit
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-N8N-LEMONADE-NATIVE-SMOKE-SUMMARY.json'
$tmpDir=Join-Path $env:TEMP 'buyflow-n8n-lemonade-native-smoke'
$credFile=Join-Path $tmpDir 'credential.json'
$workflowFile=Join-Path $tmpDir 'workflow.json'

function Find-N8nCmd {
  $candidates=@()
  $cmd=Get-Command n8n -ErrorAction SilentlyContinue
  if($cmd){$candidates += $cmd.Source}
  if($env:APPDATA){$candidates += (Join-Path $env:APPDATA 'npm\n8n.cmd')}
  if($env:APPDATA){$candidates += (Join-Path $env:APPDATA 'npm\n8n.ps1')}
  $candidates += 'C:\Program Files\nodejs\n8n.cmd'
  foreach($c in ($candidates | Select-Object -Unique)){
    if($c -and (Test-Path -LiteralPath $c)){return $c}
  }
  return $null
}

function Test-Port5678 {
  try {
    $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  }catch{return $false}
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - N8N NATIVE LEMONADE SMOKE PREP/TEST' -ForegroundColor Cyan
Write-Host 'Isolated test only: no Gmail, no webhook, no BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$n8nCmd=Find-N8nCmd
if(-not $n8nCmd){throw 'N8N_COMMAND_NOT_FOUND'}
$n8nVersion=(& $n8nCmd --version 2>$null | Select-Object -First 1).ToString().Trim()
Write-Host ('n8n: '+$n8nVersion+' -> '+$n8nCmd) -ForegroundColor Green
if($n8nVersion -ne $expectedN8nVersion){throw ('UNEXPECTED_N8N_VERSION:'+ $n8nVersion)}

$health=Invoke-RestMethod -Uri 'http://127.0.0.1:13305/v1/health' -Method Get -TimeoutSec 15
if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}
Write-Host 'Lemonade API: READY' -ForegroundColor Green

# Confirm the exact native Lemonade node and credential files exist in installed n8n.
$npmRoot=(& npm root -g 2>$null | Select-Object -First 1).ToString().Trim()
if(-not $npmRoot){throw 'NPM_GLOBAL_ROOT_NOT_FOUND'}
$n8nRoot=Join-Path $npmRoot 'n8n'
if(-not (Test-Path -LiteralPath $n8nRoot)){throw ('N8N_PACKAGE_ROOT_NOT_FOUND:'+ $n8nRoot)}
$chatNode=@(Get-ChildItem -LiteralPath $n8nRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^LmChatLemonade\.node\.(js|ts)$'})
$credNode=@(Get-ChildItem -LiteralPath $n8nRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^LemonadeApi\.credentials\.(js|ts)$'})
if($chatNode.Count -lt 1){throw 'LEMONADE_CHAT_NODE_NOT_FOUND'}
if($credNode.Count -lt 1){throw 'LEMONADE_CREDENTIAL_TYPE_NOT_FOUND'}
Write-Host 'Native Lemonade Chat Model node: FOUND' -ForegroundColor Green
Write-Host 'Native Lemonade credential type: FOUND' -ForegroundColor Green

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri ($repoRaw+'/scripts/n8n/BuyFlow-LEMONADE-LOCAL-CREDENTIAL.json') -OutFile $credFile
Invoke-WebRequest -UseBasicParsing -Uri ($repoRaw+'/scripts/n8n/BuyFlow-N8N-LEMONADE-SMOKE-WORKFLOW.json') -OutFile $workflowFile
$credJson=Get-Content -LiteralPath $credFile -Raw | ConvertFrom-Json
$wfJson=Get-Content -LiteralPath $workflowFile -Raw | ConvertFrom-Json
if([string]$credJson[0].id -ne $credentialId){throw 'CREDENTIAL_ASSET_ID_MISMATCH'}
if([string]$wfJson.id -ne $workflowId){throw 'WORKFLOW_ASSET_ID_MISMATCH'}
Write-Host 'Pinned credential/workflow assets: READY' -ForegroundColor Green

# For safe CLI import/execute, temporarily stop only the process that owns localhost:5678.
$wasRunning=Test-Port5678
$stoppedPid=$null
if($wasRunning){
  $conn=Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if(-not $conn){throw 'N8N_PORT_OWNER_NOT_FOUND'}
  $pidToStop=[int]$conn.OwningProcess
  $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidToStop) -ErrorAction SilentlyContinue
  $cmdline=[string]$proc.CommandLine
  if($cmdline -notmatch '(?i)n8n'){throw ('PORT_5678_OWNER_NOT_N8N:'+ $cmdline)}
  Write-Host ('Temporarily stopping n8n PID '+$pidToStop+' for CLI import/test...') -ForegroundColor Yellow
  Stop-Process -Id $pidToStop -Force
  $stoppedPid=$pidToStop
  Start-Sleep -Seconds 2
  if(Test-Port5678){throw 'N8N_DID_NOT_STOP'}
}

try {
  Write-Host 'Importing isolated Lemonade credential...' -ForegroundColor Yellow
  & $n8nCmd import:credentials --input=$credFile
  if($LASTEXITCODE -ne 0){throw ('N8N_CREDENTIAL_IMPORT_FAILED:'+ $LASTEXITCODE)}

  Write-Host 'Importing isolated smoke workflow...' -ForegroundColor Yellow
  & $n8nCmd import:workflow --input=$workflowFile
  if($LASTEXITCODE -ne 0){throw ('N8N_WORKFLOW_IMPORT_FAILED:'+ $LASTEXITCODE)}

  Write-Host ('Executing workflow '+$workflowId+' through n8n CLI...') -ForegroundColor Yellow
  $raw=& $n8nCmd execute --id=$workflowId --rawOutput 2>&1 | Out-String
  $execCode=$LASTEXITCODE
  if($execCode -ne 0){throw ('N8N_WORKFLOW_EXECUTE_FAILED:'+ $execCode+' OUTPUT='+$raw)}
  if($raw -notmatch 'BUYFLOW_N8N_LEMONADE_OK'){
    throw ('EXPECTED_SMOKE_TOKEN_NOT_FOUND OUTPUT='+$raw)
  }

  $summary=[ordered]@{
    completed_at=(Get-Date).ToString('o')
    pass=$true
    n8n_version=$n8nVersion
    n8n_command=$n8nCmd
    lemonade_base_url=$lemonadeBase
    model=$expectedModel
    credential_id=$credentialId
    workflow_id=$workflowId
    expected_token='BUYFLOW_N8N_LEMONADE_OK'
    native_lemonade_chat_node_found=$true
    native_lemonade_credential_found=$true
    gmail_touched=$false
    webhook_created=$false
    buyflow_writes=0
    production_changed=$false
  }
  $summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Green
  Write-Host 'N8N -> LEMONADE -> GEMMA NATIVE SMOKE: PASS' -ForegroundColor Green
  Write-Host 'Output token: BUYFLOW_N8N_LEMONADE_OK' -ForegroundColor Cyan
  Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
  Write-Host 'Gmail untouched | webhook 0 | BuyFlow writes 0 | production unchanged' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Green
}
finally {
  if($wasRunning){
    Write-Host 'Restarting n8n localhost:5678...' -ForegroundColor Yellow
    Start-Process -FilePath $n8nCmd -ArgumentList 'start' -WindowStyle Hidden
    $ready=$false
    for($i=0;$i -lt 30;$i++){
      Start-Sleep -Seconds 1
      if(Test-Port5678){$ready=$true;break}
    }
    Write-Host ('n8n restarted: '+$ready) -ForegroundColor $(if($ready){'Green'}else{'Yellow'})
  }
}
