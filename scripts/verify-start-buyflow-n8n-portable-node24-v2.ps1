$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$nodeVersion='24.20.0'
$n8nVersion='2.37.3'
$toolsRoot=Join-Path $env:USERPROFILE 'BuyFlowTools'
$nodeDir=Join-Path $toolsRoot "node-v$nodeVersion-win-x64"
$n8nDir=Join-Path $toolsRoot "n8n-$n8nVersion-node24"
$nodeExe=Join-Path $nodeDir 'node.exe'
$n8nBin=Join-Path $n8nDir 'node_modules\n8n\bin\n8n'
$stdoutLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDOUT.log'
$stderrLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDERR.log'
$summaryPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-VERIFY-V2.json'
$launcher=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-START-N8N-NODE24.cmd'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - PORTABLE N8N NODE24 VERIFY / START V2' -ForegroundColor Cyan
Write-Host 'No install. No workflow/credential changes. No BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

if(-not (Test-Path -LiteralPath $nodeExe)){throw 'PORTABLE_NODE24_NOT_FOUND'}
if(-not (Test-Path -LiteralPath $n8nBin)){throw 'PORTABLE_N8N_NOT_FOUND'}

$portableNodeVersion=(& $nodeExe --version | Select-Object -First 1).ToString().Trim()
$actualN8n=(& $nodeExe $n8nBin --version 2>$null | Select-Object -First 1).ToString().Trim()
Write-Host ('Portable Node: '+$portableNodeVersion) -ForegroundColor Green
Write-Host ('n8n version: '+$actualN8n) -ForegroundColor Green
if($portableNodeVersion -ne "v$nodeVersion"){throw ('UNEXPECTED_PORTABLE_NODE_VERSION:'+ $portableNodeVersion)}
if($actualN8n -ne $n8nVersion){throw ('N8N_VERSION_MISMATCH:'+ $actualN8n)}

# npm may hoist @n8n/n8n-nodes-langchain outside node_modules/n8n, so search the full portable install tree.
$chatMatches=@(Get-ChildItem -LiteralPath $n8nDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match '^LmChatLemonade\.node\.(js|cjs|mjs|ts)$' -or $_.FullName -match 'LMChatLemonade'
})
$credMatches=@(Get-ChildItem -LiteralPath $n8nDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match '^LemonadeApi\.credentials\.(js|cjs|mjs|ts)$'
})
$hasChat=$chatMatches.Count -gt 0
$hasCred=$credMatches.Count -gt 0
Write-Host ('Lemonade Chat Model node: '+$(if($hasChat){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasChat){'Green'}else{'Red'})
if($hasChat){Write-Host ('  '+($chatMatches[0].FullName)) -ForegroundColor DarkGray}
Write-Host ('Lemonade credential type: '+$(if($hasCred){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasCred){'Green'}else{'Red'})
if($hasCred){Write-Host ('  '+($credMatches[0].FullName)) -ForegroundColor DarkGray}

# Create a stable launcher using only portable Node24.
$cmd=@"
@echo off
setlocal
set "PATH=$nodeDir;%PATH%"
"$nodeExe" "$n8nBin" start
"@
Set-Content -LiteralPath $launcher -Value $cmd -Encoding ASCII

# If already reachable, do not start a second instance.
$reachable=$false
try{
  $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -TimeoutSec 3
  $reachable=$r.StatusCode -ge 200 -and $r.StatusCode -lt 500
}catch{}

if(-not $reachable){
  Remove-Item -LiteralPath $stdoutLog,$stderrLog -Force -ErrorAction SilentlyContinue
  $oldPath=$env:PATH
  $env:PATH=$nodeDir+';'+$env:PATH
  try{
    Write-Host 'Starting portable n8n on localhost:5678...' -ForegroundColor Yellow
    Start-Process -FilePath $nodeExe -ArgumentList @($n8nBin,'start') -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog | Out-Null
  } finally {
    $env:PATH=$oldPath
  }
  for($i=0;$i -lt 90;$i++){
    Start-Sleep -Seconds 1
    try{
      $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -TimeoutSec 2
      if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){$reachable=$true;break}
    }catch{}
  }
}

$stderrTail=''
$stdoutTail=''
if(Test-Path -LiteralPath $stderrLog){$stderrTail=((Get-Content -LiteralPath $stderrLog -Tail 40 -ErrorAction SilentlyContinue) -join "`n")}
if(Test-Path -LiteralPath $stdoutLog){$stdoutTail=((Get-Content -LiteralPath $stdoutLog -Tail 40 -ErrorAction SilentlyContinue) -join "`n")}

$summary=[ordered]@{
  checked_at=(Get-Date).ToString('o')
  portable_node_version=$portableNodeVersion
  n8n_version=$actualN8n
  lemonade_chat_model_node_found=$hasChat
  lemonade_credential_found=$hasCred
  lemonade_chat_match=$(if($hasChat){$chatMatches[0].FullName}else{$null})
  lemonade_credential_match=$(if($hasCred){$credMatches[0].FullName}else{$null})
  localhost_5678_reachable=$reachable
  stdout_log=$stdoutLog
  stderr_log=$stderrLog
  launcher=$launcher
  workflow_changes=0
  credential_changes=0
  buyflow_writes=0
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor $(if($reachable -and $hasChat -and $hasCred){'Green'}else{'Yellow'})
if($reachable -and $hasChat -and $hasCred){
  Write-Host 'N8N 2.37.3 + NODE24 + LEMONADE: READY' -ForegroundColor Green
}else{
  Write-Host 'N8N VERIFY: BLOCKED' -ForegroundColor Yellow
  if(-not $reachable){
    Write-Host 'Reason: localhost:5678 did not become ready.' -ForegroundColor Yellow
    if($stderrTail){Write-Host '--- STDERR tail ---' -ForegroundColor DarkYellow; Write-Host $stderrTail}
    if($stdoutTail){Write-Host '--- STDOUT tail ---' -ForegroundColor DarkYellow; Write-Host $stdoutTail}
  }
  if(-not $hasChat){Write-Host 'Reason: Lemonade Chat Model file not found in full install tree.' -ForegroundColor Yellow}
  if(-not $hasCred){Write-Host 'Reason: Lemonade credential file not found in full install tree.' -ForegroundColor Yellow}
}
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Workflow changes: 0 | Credentials changed: 0 | BuyFlow writes: 0' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor $(if($reachable -and $hasChat -and $hasCred){'Green'}else{'Yellow'})

if(-not ($reachable -and $hasChat -and $hasCred)){exit 2}
