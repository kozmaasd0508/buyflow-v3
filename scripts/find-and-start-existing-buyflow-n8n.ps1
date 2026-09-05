$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-N8N-DEEP-DISCOVERY.json'
$lemonadeBase='http://127.0.0.1:13305/v1'
$expectedModel='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'

function Test-N8nPort {
  try {
    $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

function Add-Candidate([System.Collections.Generic.List[string]]$list,[string]$path){
  if([string]::IsNullOrWhiteSpace($path)){return}
  try{$full=[IO.Path]::GetFullPath($path)}catch{$full=$path}
  if((Test-Path -LiteralPath $full) -and -not $list.Contains($full)){$list.Add($full)}
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - N8N DEEP WINDOWS DISCOVERY / SAFE START' -ForegroundColor Cyan
Write-Host 'Existing install only. No npm install. No workflow/credential changes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$nodeCmd=Get-Command node -ErrorAction SilentlyContinue
$npmCmd=Get-Command npm -ErrorAction SilentlyContinue
Write-Host ('node in PATH: '+[bool]$nodeCmd) -ForegroundColor DarkGray
Write-Host ('npm in PATH: '+[bool]$npmCmd) -ForegroundColor DarkGray
if($nodeCmd){Write-Host ('node: '+$nodeCmd.Source) -ForegroundColor DarkGray}
if($npmCmd){Write-Host ('npm: '+$npmCmd.Source) -ForegroundColor DarkGray}

$candidates=New-Object 'System.Collections.Generic.List[string]'
Add-Candidate $candidates (Join-Path $env:APPDATA 'npm\n8n.cmd')
Add-Candidate $candidates (Join-Path $env:APPDATA 'npm\n8n.ps1')
Add-Candidate $candidates (Join-Path $env:APPDATA 'npm\node_modules\n8n\bin\n8n')
Add-Candidate $candidates (Join-Path $env:LOCALAPPDATA 'npm\n8n.cmd')
Add-Candidate $candidates (Join-Path $env:LOCALAPPDATA 'npm\n8n.ps1')
Add-Candidate $candidates (Join-Path $env:ProgramFiles 'nodejs\n8n.cmd')

$prefixes=New-Object 'System.Collections.Generic.List[string]'
if($npmCmd){
  try{
    $p=(& npm config get prefix 2>$null | Select-Object -First 1).ToString().Trim()
    if($p){$prefixes.Add($p); Add-Candidate $candidates (Join-Path $p 'n8n.cmd'); Add-Candidate $candidates (Join-Path $p 'n8n.ps1')}
  }catch{}
  try{
    $root=(& npm root -g 2>$null | Select-Object -First 1).ToString().Trim()
    if($root){Add-Candidate $candidates (Join-Path $root 'n8n\bin\n8n')}
  }catch{}
}

# Limited recursive discovery in normal npm locations only; avoids scanning the whole disk.
$roots=@(
  (Join-Path $env:APPDATA 'npm'),
  (Join-Path $env:LOCALAPPDATA 'npm'),
  (Join-Path $env:USERPROFILE 'AppData\Roaming\npm')
) | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ }
foreach($root in $roots){
  try{
    Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @('n8n.cmd','n8n.ps1') -or ($_.Name -eq 'n8n' -and $_.DirectoryName -match 'n8n.*bin') } |
      ForEach-Object { Add-Candidate $candidates $_.FullName }
  }catch{}
}

# Inspect running process command lines for an n8n path hint.
$processHints=@()
try{
  $processHints=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '(?i)n8n' } |
    Select-Object ProcessId,ExecutablePath,CommandLine)
}catch{}

$n8nReachableBefore=Test-N8nPort
Write-Host ('n8n localhost:5678 before: '+$n8nReachableBefore) -ForegroundColor $(if($n8nReachableBefore){'Green'}else{'Yellow'})
Write-Host ('n8n executable candidates found: '+$candidates.Count) -ForegroundColor $(if($candidates.Count -gt 0){'Green'}else{'Yellow'})
foreach($c in $candidates){Write-Host ('  '+$c) -ForegroundColor DarkGray}

$selected=$null
$n8nVersion='UNKNOWN'
foreach($c in $candidates){
  try{
    if($c.EndsWith('.ps1',[StringComparison]::OrdinalIgnoreCase)){
      $v=(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $c --version 2>$null | Select-Object -First 1)
    }elseif($c.EndsWith('.cmd',[StringComparison]::OrdinalIgnoreCase)){
      $v=(& cmd.exe /d /c ('"'+$c+'" --version') 2>$null | Select-Object -First 1)
    }else{
      if(-not $nodeCmd){continue}
      $v=(& node $c --version 2>$null | Select-Object -First 1)
    }
    if($v){
      $selected=$c
      $n8nVersion=$v.ToString().Trim()
      break
    }
  }catch{}
}

if($selected){
  Write-Host ('Existing n8n selected: '+$selected) -ForegroundColor Green
  Write-Host ('n8n version: '+$n8nVersion) -ForegroundColor Green
}

$started=$false
if(-not $n8nReachableBefore -and $selected){
  Write-Host 'Existing n8n found but not running. Starting it in a separate window...' -ForegroundColor Yellow
  if($selected.EndsWith('.ps1',[StringComparison]::OrdinalIgnoreCase)){
    Start-Process powershell.exe -ArgumentList @('-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$selected+'"')) | Out-Null
  }elseif($selected.EndsWith('.cmd',[StringComparison]::OrdinalIgnoreCase)){
    Start-Process cmd.exe -ArgumentList @('/k',('"'+$selected+'"')) | Out-Null
  }else{
    Start-Process cmd.exe -ArgumentList @('/k',('node "'+$selected+'"')) | Out-Null
  }
  for($i=0;$i -lt 30;$i++){
    Start-Sleep -Seconds 1
    if(Test-N8nPort){$started=$true;break}
  }
}

$n8nReachableAfter=Test-N8nPort
if($n8nReachableAfter){Write-Host 'n8n localhost:5678 READY.' -ForegroundColor Green}
elseif($selected){Write-Host 'Existing n8n found, but port 5678 did not become ready.' -ForegroundColor Yellow}
else{Write-Host 'No existing n8n executable was found in normal Windows/npm locations.' -ForegroundColor Yellow}

# Robust Lemonade model visibility diagnostic. This is diagnostic only; smoke test already proved inference.
$modelVisible=$false
$modelDiagnostics=@()
foreach($uri in @($lemonadeBase+'/models',$lemonadeBase+'/models?show_all=true')){
  try{
    $obj=Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 10
    $json=$obj|ConvertTo-Json -Depth 20 -Compress
    $hit=$json -match [regex]::Escape($expectedModel)
    $modelDiagnostics += [ordered]@{uri=$uri;ok=$true;contains_expected_model=$hit}
    if($hit){$modelVisible=$true}
  }catch{
    $modelDiagnostics += [ordered]@{uri=$uri;ok=$false;error=$_.Exception.Message}
  }
}
Write-Host ('Lemonade model discoverable in model-list endpoints: '+$modelVisible) -ForegroundColor $(if($modelVisible){'Green'}else{'Yellow'})
Write-Host 'Note: prior direct smoke inference PASS is stronger proof that the model itself works.' -ForegroundColor DarkGray

$summary=[ordered]@{
  checked_at=(Get-Date).ToString('o')
  changed_workflows=0
  changed_credentials=0
  npm_install_performed=$false
  n8n_reachable_before=$n8nReachableBefore
  n8n_reachable_after=$n8nReachableAfter
  n8n_started_by_script=$started
  selected_n8n=$selected
  n8n_version=$n8nVersion
  candidate_paths=@($candidates)
  npm_prefixes=@($prefixes)
  running_n8n_process_hints=@($processHints)
  lemonade_expected_model=$expectedModel
  lemonade_model_list_discoverable=$modelVisible
  lemonade_model_diagnostics=@($modelDiagnostics)
}
$summary|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor $(if($n8nReachableAfter){'Green'}else{'Yellow'})
if($n8nReachableAfter){
  Write-Host 'N8N EXISTING INSTALL: READY' -ForegroundColor Green
  Write-Host 'Next: verify built-in Lemonade node/credential in this exact n8n install.' -ForegroundColor Green
}else{
  Write-Host 'N8N EXISTING INSTALL: NOT READY' -ForegroundColor Yellow
  if(-not $selected){Write-Host 'Next step will be a controlled n8n install; this script intentionally did NOT install anything.' -ForegroundColor Yellow}
}
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'No workflow changes | No credential changes | No npm install' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor $(if($n8nReachableAfter){'Green'}else{'Yellow'})

if(-not $n8nReachableAfter){exit 2}
