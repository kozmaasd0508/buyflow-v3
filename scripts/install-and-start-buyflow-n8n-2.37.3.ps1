$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$targetVersion='2.37.3'
$expectedModel='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$lemonadeBase='http://127.0.0.1:13305/v1'
$desktop=[Environment]::GetFolderPath('Desktop')
$summaryPath=Join-Path $desktop 'BuyFlow-N8N-2373-INSTALL-SUMMARY.json'
$backupRoot=Join-Path $desktop ('BuyFlow-N8N-BACKUP-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$userN8n=Join-Path $env:USERPROFILE '.n8n'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - CONTROLLED N8N 2.37.3 INSTALL / START' -ForegroundColor Cyan
Write-Host 'Preserve existing .n8n data. No workflow or credential creation.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$nodeCmd=Get-Command node -ErrorAction SilentlyContinue
$npmCmd=Get-Command npm -ErrorAction SilentlyContinue
if(-not $nodeCmd){throw 'NODE_NOT_FOUND'}
if(-not $npmCmd){throw 'NPM_NOT_FOUND'}
$nodeVersion=(& node --version | Select-Object -First 1).ToString().Trim()
$npmVersion=(& npm --version | Select-Object -First 1).ToString().Trim()
Write-Host ('Node: '+$nodeVersion) -ForegroundColor Green
Write-Host ('npm:  '+$npmVersion) -ForegroundColor Green

# Confirm exact package exists before touching global npm state.
$published=(& npm view ('n8n@'+$targetVersion) version 2>$null | Select-Object -First 1).ToString().Trim()
if($published -ne $targetVersion){throw ('N8N_PACKAGE_VERSION_NOT_AVAILABLE:'+ $published)}
Write-Host ('n8n package confirmed on npm: '+$published) -ForegroundColor Green

# Preserve the existing user database/config if present. n8n is not running, so copy is safe.
$backupFiles=@()
if(Test-Path -LiteralPath $userN8n){
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  foreach($name in @('database.sqlite','config','config.json')){
    $src=Join-Path $userN8n $name
    if(Test-Path -LiteralPath $src){
      Copy-Item -LiteralPath $src -Destination (Join-Path $backupRoot $name) -Force
      $backupFiles += $name
    }
  }
  Write-Host ('.n8n data directory found: '+$userN8n) -ForegroundColor Green
  if($backupFiles.Count -gt 0){
    Write-Host ('Backup created: '+$backupRoot) -ForegroundColor Green
    Write-Host ('Backed up: '+($backupFiles -join ', ')) -ForegroundColor DarkGray
  } else {
    Write-Host '.n8n folder exists, but no database/config file matched the backup list.' -ForegroundColor Yellow
  }
}else{
  Write-Host 'No existing .n8n data directory found. A fresh local n8n profile will be created on first start.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host ('Installing n8n@'+$targetVersion+' globally...') -ForegroundColor Yellow
& npm install -g ('n8n@'+$targetVersion) --no-fund --no-audit
if($LASTEXITCODE -ne 0){throw ('NPM_INSTALL_FAILED:'+ $LASTEXITCODE)}

# Resolve the installed command without relying on the current PATH refresh.
$candidates=@(
  (Join-Path $env:APPDATA 'npm\n8n.cmd'),
  (Join-Path $env:APPDATA 'npm\n8n.ps1')
)
$n8nPath=$null
foreach($c in $candidates){if(Test-Path -LiteralPath $c){$n8nPath=$c;break}}
if(-not $n8nPath){
  $cmd=Get-Command n8n -ErrorAction SilentlyContinue
  if($cmd){$n8nPath=$cmd.Source}
}
if(-not $n8nPath){throw 'N8N_COMMAND_STILL_NOT_FOUND_AFTER_INSTALL'}

$installedVersion=(& $n8nPath --version 2>$null | Select-Object -First 1).ToString().Trim()
Write-Host ('Installed n8n: '+$installedVersion) -ForegroundColor Green
Write-Host ('Command: '+$n8nPath) -ForegroundColor DarkGray
if($installedVersion -ne $targetVersion){throw ('N8N_VERSION_MISMATCH:'+ $installedVersion)}

# Verify Lemonade node/credential are physically present in this exact installation.
$npmRoot=(& npm root -g 2>$null | Select-Object -First 1).ToString().Trim()
$n8nPkg=Join-Path $npmRoot 'n8n'
$nodeFiles=@()
$credFiles=@()
if(Test-Path -LiteralPath $n8nPkg){
  $nodeFiles=@(Get-ChildItem -LiteralPath $n8nPkg -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'LmChatLemonade|LmLemonade'} | Select-Object -ExpandProperty FullName)
  $credFiles=@(Get-ChildItem -LiteralPath $n8nPkg -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^LemonadeApi\.credentials\.(js|ts)$'} | Select-Object -ExpandProperty FullName)
}
$hasChatNode=@($nodeFiles | Where-Object {$_ -match 'LmChatLemonade'}).Count -gt 0
$hasCredential=$credFiles.Count -gt 0
Write-Host ('Lemonade Chat Model node: '+$(if($hasChatNode){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasChatNode){'Green'}else{'Red'})
Write-Host ('Lemonade credential type: '+$(if($hasCredential){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasCredential){'Green'}else{'Red'})

# Stronger model existence check than list parsing: query the exact model resource.
$modelVisible=$false
try{
  $modelCheck=Invoke-RestMethod -Uri ($lemonadeBase+'/models/'+[uri]::EscapeDataString($expectedModel)) -Method Get -TimeoutSec 15
  if($modelCheck){$modelVisible=$true}
}catch{}
Write-Host ('Lemonade exact model endpoint: '+$modelVisible) -ForegroundColor $(if($modelVisible){'Green'}else{'Yellow'})

# Start n8n only if it is not already listening.
function Test-N8nReachable {
  try{
    $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  }catch{return $false}
}

$before=Test-N8nReachable
if(-not $before){
  Write-Host 'Starting n8n on localhost:5678...' -ForegroundColor Yellow
  Start-Process -FilePath $n8nPath -ArgumentList 'start' -WindowStyle Minimized | Out-Null
  for($i=0;$i -lt 45;$i++){
    Start-Sleep -Seconds 1
    if(Test-N8nReachable){break}
  }
}
$reachable=Test-N8nReachable
Write-Host ('n8n localhost:5678 reachable: '+$reachable) -ForegroundColor $(if($reachable){'Green'}else{'Red'})

$pass=($installedVersion -eq $targetVersion) -and $hasChatNode -and $hasCredential -and $reachable
$summary=[ordered]@{
  completed_at=(Get-Date).ToString('o')
  target_version=$targetVersion
  installed_version=$installedVersion
  node_version=$nodeVersion
  npm_version=$npmVersion
  n8n_command=$n8nPath
  existing_data_dir=(Test-Path -LiteralPath $userN8n)
  backup_path=$(if($backupFiles.Count -gt 0){$backupRoot}else{$null})
  backup_files=$backupFiles
  lemonade_chat_model_node_found=$hasChatNode
  lemonade_credential_found=$hasCredential
  lemonade_exact_model_endpoint_visible=$modelVisible
  n8n_port_5678_reachable=$reachable
  workflow_changes=0
  credential_changes=0
  pass=$pass
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Yellow'})
if($pass){
  Write-Host 'N8N 2.37.3 + LEMONADE SUPPORT: READY' -ForegroundColor Green
  Write-Host 'Next safe step: create Lemonade credential + isolated test workflow.' -ForegroundColor Green
}else{
  Write-Host 'N8N INSTALL/START: BLOCKED' -ForegroundColor Yellow
  Write-Host 'No workflow or credential was created. Use the details above for the next fix.' -ForegroundColor Yellow
}
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Workflow changes: 0 | Credential changes: 0' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Yellow'})

if(-not $pass){exit 2}
