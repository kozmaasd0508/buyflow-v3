$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$lemonadeBase='http://127.0.0.1:13305/v1'
$expectedModel='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-N8N-LEMONADE-PREFLIGHT.json'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - N8N + LEMONADE PREFLIGHT V2' -ForegroundColor Cyan
Write-Host 'Read-only. PATH-fuggetlen Windows felderites.' -ForegroundColor Green
Write-Host 'No workflow change. No credential change.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

# 1) n8n local reachability first. This proves a running instance without needing CLI PATH.
$n8nReachable=$false
try {
  $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 5
  $n8nReachable=$r.StatusCode -ge 200 -and $r.StatusCode -lt 500
} catch {}
Write-Host ('n8n localhost:5678 reachable: '+$n8nReachable) -ForegroundColor $(if($n8nReachable){'Green'}else{'Yellow'})

# 2) Find CLI/package roots without assuming PATH.
$candidateCommands=New-Object System.Collections.Generic.List[string]
$candidateRoots=New-Object System.Collections.Generic.List[string]

$n8nCmd=Get-Command n8n -ErrorAction SilentlyContinue
if($n8nCmd -and $n8nCmd.Source){$candidateCommands.Add([string]$n8nCmd.Source)}

$commonCommands=@(
  (Join-Path $env:APPDATA 'npm\n8n.cmd'),
  (Join-Path $env:APPDATA 'npm\n8n.ps1'),
  (Join-Path $env:LOCALAPPDATA 'npm\n8n.cmd'),
  (Join-Path $env:LOCALAPPDATA 'npm\n8n.ps1')
)
foreach($p in $commonCommands){if(Test-Path -LiteralPath $p){$candidateCommands.Add($p)}}

# npm root if npm itself is available.
$npmRoot=$null
$npmCmd=Get-Command npm -ErrorAction SilentlyContinue
if($npmCmd){
  try{$npmRoot=((& npm root -g 2>$null | Select-Object -First 1).ToString().Trim())}catch{}
}
if($npmRoot){$candidateRoots.Add((Join-Path $npmRoot 'n8n'))}

# Standard Windows npm global locations.
$candidateRoots.Add((Join-Path $env:APPDATA 'npm\node_modules\n8n'))
$candidateRoots.Add((Join-Path $env:LOCALAPPDATA 'npm\node_modules\n8n'))

# Running process command lines can reveal a non-standard npm/node install.
$runningN8n=@()
try {
  $runningN8n=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '^node(\.exe)?$' -and [string]$_.CommandLine -match '(?i)(^|[\\/\s])n8n([\\/\s]|$|\.cmd|\.ps1)'
  })
  foreach($proc in $runningN8n){
    $cmdline=[string]$proc.CommandLine
    $matches=[regex]::Matches($cmdline,'(?i)([A-Z]:\\[^"\r\n]*?\\node_modules\\n8n)(?=\\|\s|"|$)')
    foreach($m in $matches){$candidateRoots.Add($m.Groups[1].Value)}
  }
}catch{}

# Dedupe and keep only actual n8n package roots.
$packageRoots=@($candidateRoots | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)
$commands=@($candidateCommands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)

if($commands.Count -gt 0){Write-Host ('n8n command candidate: '+$commands[0]) -ForegroundColor DarkGray}
if($packageRoots.Count -gt 0){Write-Host ('n8n package root: '+$packageRoots[0]) -ForegroundColor DarkGray}
if($runningN8n.Count -gt 0){Write-Host ('running n8n-like node process(es): '+$runningN8n.Count) -ForegroundColor DarkGray}

# 3) Resolve version from package.json first; CLI is only fallback.
$n8nVersion=$null
foreach($root in $packageRoots){
  $pkg=Join-Path $root 'package.json'
  if(Test-Path -LiteralPath $pkg){
    try{$n8nVersion=[string]((Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version); if($n8nVersion){break}}catch{}
  }
}
if(-not $n8nVersion -and $commands.Count -gt 0){
  try{$n8nVersion=((& $commands[0] --version 2>$null | Select-Object -First 1).ToString().Trim())}catch{}
}
if($n8nVersion){Write-Host ('n8n version: '+$n8nVersion) -ForegroundColor Green}else{Write-Host 'n8n version: UNKNOWN' -ForegroundColor Yellow}

# 4) Locate Lemonade built-in node and credential inside the installed n8n package.
$lemonadeNodeFiles=@()
$lemonadeCredentialFiles=@()
foreach($root in $packageRoots){
  # Search only the @n8n LangChain package area where these built-ins live.
  $langRoots=@(
    (Join-Path $root 'node_modules\@n8n\nodes-langchain'),
    (Join-Path $root 'node_modules\n8n\node_modules\@n8n\nodes-langchain'),
    (Join-Path $root 'packages\@n8n\nodes-langchain')
  ) | Where-Object { Test-Path -LiteralPath $_ }
  foreach($lr in $langRoots){
    $lemonadeNodeFiles += @(Get-ChildItem -LiteralPath $lr -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'LmChatLemonade|LmLemonade' } |
      Select-Object -ExpandProperty FullName)
    $lemonadeCredentialFiles += @(Get-ChildItem -LiteralPath $lr -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^LemonadeApi\.credentials\.(js|ts)$' } |
      Select-Object -ExpandProperty FullName)
  }
}
$lemonadeNodeFiles=@($lemonadeNodeFiles | Select-Object -Unique)
$lemonadeCredentialFiles=@($lemonadeCredentialFiles | Select-Object -Unique)
$hasChatNode=@($lemonadeNodeFiles | Where-Object { $_ -match 'LmChatLemonade' }).Count -gt 0
$hasCredential=$lemonadeCredentialFiles.Count -gt 0
Write-Host ('Lemonade Chat Model node: '+$(if($hasChatNode){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasChatNode){'Green'}else{'Yellow'})
Write-Host ('Lemonade credential type: '+$(if($hasCredential){'FOUND'}else{'NOT FOUND'})) -ForegroundColor $(if($hasCredential){'Green'}else{'Yellow'})

# 5) Lemonade API / model discovery. This is the same /models endpoint used by the n8n credential test.
$models=Invoke-RestMethod -Uri ($lemonadeBase+'/models') -Method Get -TimeoutSec 15
$modelIds=@()
if($models.data){$modelIds=@($models.data | ForEach-Object {[string]$_.id})}
$modelVisible=$modelIds -contains $expectedModel
Write-Host ('Lemonade API: READY ('+$lemonadeBase+')') -ForegroundColor Green
Write-Host ('BuyFlow model visible: '+$modelVisible) -ForegroundColor $(if($modelVisible){'Green'}else{'Red'})
if($modelVisible){Write-Host ('Model: '+$expectedModel) -ForegroundColor DarkGray}

# We distinguish 'n8n not running' from 'n8n package not discoverable'.
$n8nDetected=$n8nReachable -or $packageRoots.Count -gt 0 -or $commands.Count -gt 0 -or $runningN8n.Count -gt 0
$pass=$n8nDetected -and $hasChatNode -and $hasCredential -and $modelVisible

$summary=[ordered]@{
  checked_at=(Get-Date).ToString('o')
  read_only=$true
  n8n_detected=$n8nDetected
  n8n_port_5678_reachable=$n8nReachable
  n8n_version=$n8nVersion
  n8n_command_candidates=@($commands)
  n8n_package_roots=@($packageRoots)
  running_n8n_process_count=$runningN8n.Count
  lemonade_base_url=$lemonadeBase
  lemonade_chat_model_node_found=$hasChatNode
  lemonade_credential_found=$hasCredential
  expected_model=$expectedModel
  expected_model_visible=$modelVisible
  lemonade_node_files=@($lemonadeNodeFiles)
  lemonade_credential_files=@($lemonadeCredentialFiles)
  pass=$pass
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Yellow'})
if($pass){
  Write-Host 'N8N + LEMONADE PREFLIGHT: PASS' -ForegroundColor Green
  Write-Host 'Safe next step: separate Lemonade credential + isolated test workflow.' -ForegroundColor Green
}else{
  Write-Host 'N8N + LEMONADE PREFLIGHT: BLOCKED' -ForegroundColor Yellow
  if(-not $n8nDetected){Write-Host 'Reason: n8n installation/running instance not detected.' -ForegroundColor Yellow}
  elseif(-not $hasChatNode -or -not $hasCredential){Write-Host 'Reason: installed n8n package does not expose the built-in Lemonade node/credential in the detected tree.' -ForegroundColor Yellow}
  elseif(-not $modelVisible){Write-Host 'Reason: Lemonade model is not visible on /v1/models.' -ForegroundColor Yellow}
  Write-Host 'No changes were made.' -ForegroundColor Yellow
}
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Workflow changes: 0 | Credentials changed: 0 | BuyFlow writes: 0' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Yellow'})

if(-not $pass){exit 2}
