$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$nodeVersion='24.20.0'
$n8nVersion='2.37.3'
$toolsRoot=Join-Path $env:USERPROFILE 'BuyFlowTools'
$nodeDir=Join-Path $toolsRoot "node-v$nodeVersion-win-x64"
$n8nDir=Join-Path $toolsRoot "n8n-$n8nVersion-node24"
$nodeExe=Join-Path $nodeDir 'node.exe'
$n8nBin=Join-Path $n8nDir 'node_modules\n8n\bin\n8n'
$packageRoot=Join-Path $n8nDir 'node_modules'

$lemonadeBase='http://127.0.0.1:13305/v1'
$expectedModel='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$credentialId='BFLemonadeCred1'
$workflowId='BFLemonadeSmoke1'
$credCommit='c977f272af32de18574f9399fb13c5fa298beb54'
$workflowCommit='2e8f5d82c2926fd9ad1a73dba9b6fd3c3a2453bd'
$repoRaw='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3'

$summaryPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-LEMONADE-NATIVE-SMOKE-SUMMARY.json'
$tmpDir=Join-Path $env:TEMP 'buyflow-n8n-lemonade-native-smoke-portable-v2'
$credFile=Join-Path $tmpDir 'credential.json'
$workflowFile=Join-Path $tmpDir 'workflow.json'
$stdoutLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDOUT.log'
$stderrLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDERR.log'

function Test-Port5678 {
  try {
    $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  }catch{return $false}
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - PORTABLE N8N -> LEMONADE -> GEMMA SMOKE V2' -ForegroundColor Cyan
Write-Host 'Isolated test only: no Gmail, no webhook, no BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

if(-not (Test-Path -LiteralPath $nodeExe)){throw ('PORTABLE_NODE_NOT_FOUND:'+ $nodeExe)}
if(-not (Test-Path -LiteralPath $n8nBin)){throw ('PORTABLE_N8N_NOT_FOUND:'+ $n8nBin)}

$portableNodeVersion=(& $nodeExe --version | Select-Object -First 1).ToString().Trim()
$n8nActual=(& $nodeExe $n8nBin --version 2>$null | Select-Object -First 1).ToString().Trim()
Write-Host ('Portable Node: '+$portableNodeVersion) -ForegroundColor Green
Write-Host ('n8n: '+$n8nActual) -ForegroundColor Green
if($portableNodeVersion -ne "v$nodeVersion"){throw ('UNEXPECTED_PORTABLE_NODE_VERSION:'+ $portableNodeVersion)}
if($n8nActual -ne $n8nVersion){throw ('UNEXPECTED_N8N_VERSION:'+ $n8nActual)}

# Verify native Lemonade support in the actual portable install, including hoisted package layout.
$chatNode=@(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.FullName -match '(?i)lmChatLemonade' -and $_.Extension -match '^\.(js|ts)$'})
$credNode=@(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^LemonadeApi\.credentials\.(js|ts)$'})
if($chatNode.Count -lt 1){throw 'LEMONADE_CHAT_NODE_NOT_FOUND'}
if($credNode.Count -lt 1){throw 'LEMONADE_CREDENTIAL_TYPE_NOT_FOUND'}
Write-Host 'Native Lemonade Chat Model node: FOUND' -ForegroundColor Green
Write-Host 'Native Lemonade credential type: FOUND' -ForegroundColor Green

# Lemonade API must already be running; do not start/modify it here.
$health=$null
try{$health=Invoke-RestMethod -Uri ($lemonadeBase+'/health') -Method Get -TimeoutSec 15}catch{}
if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}
Write-Host 'Lemonade API: READY' -ForegroundColor Green

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$credUrl="$repoRaw/$credCommit/scripts/n8n/BuyFlow-LEMONADE-LOCAL-CREDENTIAL.json"
$workflowUrl="$repoRaw/$workflowCommit/scripts/n8n/BuyFlow-N8N-LEMONADE-SMOKE-WORKFLOW.json"
Invoke-WebRequest -UseBasicParsing -Uri $credUrl -OutFile $credFile
Invoke-WebRequest -UseBasicParsing -Uri $workflowUrl -OutFile $workflowFile

$credJson=Get-Content -LiteralPath $credFile -Raw | ConvertFrom-Json
$wfJson=Get-Content -LiteralPath $workflowFile -Raw | ConvertFrom-Json
if([string]$credJson[0].id -ne $credentialId){throw 'CREDENTIAL_ASSET_ID_MISMATCH'}
if([string]$credJson[0].data.baseUrl -ne $lemonadeBase){throw 'CREDENTIAL_BASE_URL_MISMATCH'}
if([string]$wfJson.id -ne $workflowId){throw 'WORKFLOW_ASSET_ID_MISMATCH'}
$lemonadeNode=@($wfJson.nodes | Where-Object {$_.type -eq '@n8n/n8n-nodes-langchain.lmChatLemonade'})
if($lemonadeNode.Count -ne 1){throw 'WORKFLOW_LEMONADE_NODE_MISMATCH'}
if([string]$lemonadeNode[0].parameters.model -ne $expectedModel){throw 'WORKFLOW_MODEL_MISMATCH'}
Write-Host 'Pinned credential/workflow assets: READY' -ForegroundColor Green

# Use portable Node for every n8n CLI subprocess and any child process it spawns.
$oldPath=$env:PATH
$env:PATH=$nodeDir+';'+$env:PATH
$wasRunning=Test-Port5678
$portOwnerPid=$null
try {
  # Safe CLI import: stop only the n8n process currently listening on 5678.
  if($wasRunning){
    $conn=Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if(-not $conn){throw 'N8N_PORT_OWNER_NOT_FOUND'}
    $portOwnerPid=[int]$conn.OwningProcess
    $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$portOwnerPid) -ErrorAction SilentlyContinue
    $cmdline=[string]$proc.CommandLine
    if($cmdline -notmatch '(?i)n8n'){throw ('PORT_5678_OWNER_NOT_N8N:'+ $cmdline)}
    Write-Host ('Temporarily stopping n8n PID '+$portOwnerPid+' for isolated CLI import/test...') -ForegroundColor Yellow
    Stop-Process -Id $portOwnerPid -Force
    Start-Sleep -Seconds 2
    if(Test-Port5678){throw 'N8N_DID_NOT_STOP'}
  }

  Write-Host 'Importing isolated local Lemonade credential...' -ForegroundColor Yellow
  & $nodeExe $n8nBin import:credentials --input=$credFile
  if($LASTEXITCODE -ne 0){throw ('N8N_CREDENTIAL_IMPORT_FAILED:'+ $LASTEXITCODE)}

  Write-Host 'Importing isolated smoke workflow...' -ForegroundColor Yellow
  & $nodeExe $n8nBin import:workflow --input=$workflowFile
  if($LASTEXITCODE -ne 0){throw ('N8N_WORKFLOW_IMPORT_FAILED:'+ $LASTEXITCODE)}

  Write-Host ('Executing workflow '+$workflowId+' through portable n8n CLI...') -ForegroundColor Yellow
  $raw=(& $nodeExe $n8nBin execute --id=$workflowId --rawOutput 2>&1 | Out-String)
  $execCode=$LASTEXITCODE
  if($execCode -ne 0){throw ('N8N_WORKFLOW_EXECUTE_FAILED:'+ $execCode+' OUTPUT='+$raw)}
  if($raw -notmatch 'BUYFLOW_N8N_LEMONADE_OK'){
    throw ('EXPECTED_SMOKE_TOKEN_NOT_FOUND OUTPUT='+$raw)
  }

  $summary=[ordered]@{
    completed_at=(Get-Date).ToString('o')
    pass=$true
    portable_node_version=$portableNodeVersion
    n8n_version=$n8nActual
    n8n_path=$n8nBin
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
  $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Green
  Write-Host 'N8N -> LEMONADE -> GEMMA NATIVE SMOKE: PASS' -ForegroundColor Green
  Write-Host 'Output token: BUYFLOW_N8N_LEMONADE_OK' -ForegroundColor Cyan
  Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
  Write-Host 'Gmail untouched | webhook 0 | BuyFlow writes 0 | production unchanged' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Green
}
finally {
  $env:PATH=$oldPath
  if($wasRunning){
    Write-Host 'Restarting portable n8n localhost:5678...' -ForegroundColor Yellow
    Remove-Item -LiteralPath $stdoutLog,$stderrLog -Force -ErrorAction SilentlyContinue
    $oldPath2=$env:PATH
    $env:PATH=$nodeDir+';'+$env:PATH
    try {
      Start-Process -FilePath $nodeExe -ArgumentList @($n8nBin,'start') -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog | Out-Null
    } finally {
      $env:PATH=$oldPath2
    }
    $ready=$false
    for($i=0;$i -lt 45;$i++){
      Start-Sleep -Seconds 1
      if(Test-Port5678){$ready=$true;break}
    }
    Write-Host ('n8n restarted: '+$ready) -ForegroundColor $(if($ready){'Green'}else{'Yellow'})
    if(-not $ready){
      Write-Host ('n8n restart logs: '+$stdoutLog+' | '+$stderrLog) -ForegroundColor Yellow
    }
  }
}
