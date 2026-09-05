$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$nodeVersion='24.20.0'
$n8nVersion='2.37.3'
$toolsRoot=Join-Path $env:USERPROFILE 'BuyFlowTools'
$nodeFolderName="node-v$nodeVersion-win-x64"
$nodeDir=Join-Path $toolsRoot $nodeFolderName
$n8nDir=Join-Path $toolsRoot "n8n-$n8nVersion-node24"
$nodeExe=Join-Path $nodeDir 'node.exe'
$npmCmd=Join-Path $nodeDir 'npm.cmd'
$n8nBin=Join-Path $n8nDir 'node_modules\n8n\bin\n8n'
$userData=Join-Path $env:USERPROFILE '.n8n'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir=Join-Path ([Environment]::GetFolderPath('Desktop')) "BuyFlow-N8N-BACKUP-$stamp"
$summaryPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-NODE24-SUMMARY.json'
$stdoutLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDOUT.log'
$stderrLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDERR.log'
$launcher=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-START-N8N-NODE24.cmd'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - PORTABLE N8N + NODE 24 SAFE INSTALL' -ForegroundColor Cyan
Write-Host 'System Node is NOT changed. Existing .n8n data is preserved.' -ForegroundColor Green
Write-Host 'No workflow/credential creation. No BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null

# Preserve existing n8n state before touching any n8n runtime.
if(Test-Path -LiteralPath $userData){
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach($name in @('database.sqlite','config')){
    $src=Join-Path $userData $name
    if(Test-Path -LiteralPath $src){Copy-Item -LiteralPath $src -Destination $backupDir -Force}
  }
  Write-Host ('Existing .n8n backup: '+$backupDir) -ForegroundColor Green
}

# Install official portable Node 24 without modifying machine-wide Node 26.
if(-not (Test-Path -LiteralPath $nodeExe)){
  $zip=Join-Path $env:TEMP "$nodeFolderName.zip"
  $sums=Join-Path $env:TEMP "node-v$nodeVersion-SHASUMS256.txt"
  $base="https://nodejs.org/download/release/v$nodeVersion"
  Write-Host ("Downloading official Node v$nodeVersion portable x64...") -ForegroundColor Yellow
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$nodeFolderName.zip" -OutFile $zip
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -OutFile $sums
  $sumLine=Get-Content -LiteralPath $sums | Where-Object { $_ -match ([regex]::Escape("$nodeFolderName.zip")+'$') } | Select-Object -First 1
  if(-not $sumLine){throw 'NODE24_SHA_ENTRY_NOT_FOUND'}
  $expected=($sumLine -split '\s+')[0].ToLowerInvariant()
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if($actual -ne $expected){throw "NODE24_SHA256_MISMATCH expected=$expected actual=$actual"}
  Write-Host 'Node archive SHA256: VERIFIED' -ForegroundColor Green
  $extractRoot=Join-Path $env:TEMP "buyflow-node24-$stamp"
  if(Test-Path -LiteralPath $extractRoot){Remove-Item -LiteralPath $extractRoot -Recurse -Force}
  Expand-Archive -LiteralPath $zip -DestinationPath $extractRoot -Force
  $extracted=Join-Path $extractRoot $nodeFolderName
  if(-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe'))){throw 'NODE24_EXTRACT_FAILED'}
  Move-Item -LiteralPath $extracted -Destination $nodeDir -Force
}

$portableNodeVersion=(& $nodeExe --version | Select-Object -First 1).ToString().Trim()
$portableNpmVersion=(& $npmCmd --version | Select-Object -First 1).ToString().Trim()
Write-Host ('Portable Node: '+$portableNodeVersion+' -> '+$nodeExe) -ForegroundColor Green
Write-Host ('Portable npm:  '+$portableNpmVersion) -ForegroundColor Green

if($portableNodeVersion -ne "v$nodeVersion"){throw ('UNEXPECTED_PORTABLE_NODE_VERSION:'+ $portableNodeVersion)}

# Force all install scripts to resolve node/npm from the portable Node 24 folder.
$oldPath=$env:PATH
$env:PATH=$nodeDir+';'+$env:PATH
try{
  $installed=$false
  if(Test-Path -LiteralPath $n8nBin){
    try{
      $existingVersion=(& $nodeExe $n8nBin --version 2>$null | Select-Object -First 1).ToString().Trim()
      if($existingVersion -eq $n8nVersion){$installed=$true}
    }catch{}
  }

  if(-not $installed){
    Write-Host ("Installing n8n@$n8nVersion locally under portable Node 24...") -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $n8nDir | Out-Null
    & $npmCmd install --prefix $n8nDir "n8n@$n8nVersion" --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw ('NPM_INSTALL_FAILED:'+ $LASTEXITCODE)}
  }else{
    Write-Host ("n8n@$n8nVersion already installed in portable folder; install skipped.") -ForegroundColor Green
  }

  if(-not (Test-Path -LiteralPath $n8nBin)){throw 'N8N_BIN_NOT_FOUND_AFTER_INSTALL'}
  $actualN8n=(& $nodeExe $n8nBin --version 2>$null | Select-Object -First 1).ToString().Trim()
  if($actualN8n -ne $n8nVersion){throw ('N8N_VERSION_MISMATCH:'+ $actualN8n)}
  Write-Host ('n8n version: '+$actualN8n) -ForegroundColor Green

  # Verify Lemonade support in this exact installed runtime.
  $packageRoot=Join-Path $n8nDir 'node_modules\n8n'
  $lemonadeNodes=@(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'LmChatLemonade|LmLemonade'})
  $lemonadeCreds=@(Get-ChildItem -LiteralPath $packageRoot -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^LemonadeApi\.credentials\.(js|ts)$'})
  $hasChat=@($lemonadeNodes | Where-Object {$_.Name -match 'LmChatLemonade'}).Count -gt 0
  $hasCred=$lemonadeCreds.Count -gt 0
  Write-Host ('Lemonade Chat Model node: '+$(if($hasChat){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasChat){'Green'}else{'Red'})
  Write-Host ('Lemonade credential type: '+$(if($hasCred){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasCred){'Green'}else{'Red'})
  if(-not ($hasChat -and $hasCred)){throw 'LEMONADE_SUPPORT_NOT_FOUND_IN_INSTALLED_N8N'}

  # Create a stable launcher that always uses portable Node 24 and the preserved default .n8n folder.
  $cmd=@"
@echo off
setlocal
set "PATH=$nodeDir;%PATH%"
"$nodeExe" "$n8nBin" start
"@
  Set-Content -LiteralPath $launcher -Value $cmd -Encoding ASCII
  Write-Host ('Launcher: '+$launcher) -ForegroundColor DarkGray

  # Start only if port 5678 is not already serving.
  $reachable=$false
  try{
    $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -TimeoutSec 3
    $reachable=$r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  }catch{}

  if(-not $reachable){
    Remove-Item -LiteralPath $stdoutLog,$stderrLog -Force -ErrorAction SilentlyContinue
    Write-Host 'Starting portable n8n on localhost:5678...' -ForegroundColor Yellow
    Start-Process -FilePath $nodeExe -ArgumentList @($n8nBin,'start') -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog | Out-Null
    for($i=0;$i -lt 60;$i++){
      Start-Sleep -Seconds 1
      try{
        $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -TimeoutSec 2
        if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){$reachable=$true;break}
      }catch{}
    }
  }

  $summary=[ordered]@{
    checked_at=(Get-Date).ToString('o')
    system_node_unchanged=$true
    portable_node_version=$portableNodeVersion
    portable_node_path=$nodeExe
    portable_npm_version=$portableNpmVersion
    n8n_version=$actualN8n
    n8n_root=$n8nDir
    n8n_user_data=$userData
    backup_dir=$(if(Test-Path -LiteralPath $backupDir){$backupDir}else{$null})
    lemonade_chat_model_node_found=$hasChat
    lemonade_credential_found=$hasCred
    localhost_5678_reachable=$reachable
    launcher=$launcher
    workflow_changes=0
    credential_changes=0
    buyflow_writes=0
  }
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor $(if($reachable){'Green'}else{'Yellow'})
  if($reachable){
    Write-Host 'PORTABLE N8N 2.37.3 + NODE 24 + LEMONADE: READY' -ForegroundColor Green
  }else{
    Write-Host 'PORTABLE N8N INSTALLED, BUT STARTUP NOT READY' -ForegroundColor Yellow
    Write-Host ('Check logs: '+$stdoutLog+' | '+$stderrLog) -ForegroundColor Yellow
  }
  Write-Host ('System Node 26: untouched') -ForegroundColor Green
  Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
  Write-Host 'Workflow changes: 0 | Credentials changed: 0 | BuyFlow writes: 0' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor $(if($reachable){'Green'}else{'Yellow'})

  if(-not $reachable){exit 2}
} finally {
  $env:PATH=$oldPath
}
