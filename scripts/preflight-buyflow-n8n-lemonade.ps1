$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$lemonadeBase='http://127.0.0.1:13305/v1'
$expectedModel='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-N8N-LEMONADE-PREFLIGHT.json'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - N8N + LEMONADE PREFLIGHT' -ForegroundColor Cyan
Write-Host 'Read-only check. No workflow change. No credential change.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

# n8n executable/version
$n8nCmd=Get-Command n8n -ErrorAction SilentlyContinue
if(-not $n8nCmd){throw 'N8N_COMMAND_NOT_FOUND'}
$n8nVersion=(& n8n --version 2>$null | Select-Object -First 1).ToString().Trim()
Write-Host ('n8n version: '+$n8nVersion) -ForegroundColor Green
Write-Host ('n8n command: '+$n8nCmd.Source) -ForegroundColor DarkGray

# Locate globally installed n8n package tree and Lemonade node/credential files.
$npmRoot=(& npm root -g 2>$null | Select-Object -First 1).ToString().Trim()
if(-not $npmRoot){throw 'NPM_GLOBAL_ROOT_NOT_FOUND'}
Write-Host ('npm global root: '+$npmRoot) -ForegroundColor DarkGray

$searchRoots=@(
  (Join-Path $npmRoot 'n8n'),
  (Join-Path $npmRoot '@n8n')
) | Where-Object { Test-Path -LiteralPath $_ }

$lemonadeNodeFiles=@()
$lemonadeCredentialFiles=@()
foreach($root in $searchRoots){
  $lemonadeNodeFiles += @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'LmChatLemonade|LmLemonade' } |
    Select-Object -ExpandProperty FullName)
  $lemonadeCredentialFiles += @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^LemonadeApi\.credentials\.(js|ts)$' } |
    Select-Object -ExpandProperty FullName)
}

$hasChatNode=@($lemonadeNodeFiles | Where-Object { $_ -match 'LmChatLemonade' }).Count -gt 0
$hasCredential=$lemonadeCredentialFiles.Count -gt 0

if($hasChatNode){
  Write-Host 'Lemonade Chat Model node: FOUND' -ForegroundColor Green
}else{
  Write-Host 'Lemonade Chat Model node: NOT FOUND' -ForegroundColor Red
}
if($hasCredential){
  Write-Host 'Lemonade credential type: FOUND' -ForegroundColor Green
}else{
  Write-Host 'Lemonade credential type: NOT FOUND' -ForegroundColor Red
}

# Lemonade API / model discovery - same endpoint n8n credential test relies on.
$models=Invoke-RestMethod -Uri ($lemonadeBase+'/models') -Method Get -TimeoutSec 15
$modelIds=@()
if($models.data){$modelIds=@($models.data | ForEach-Object {[string]$_.id})}
$modelVisible=$modelIds -contains $expectedModel
Write-Host ('Lemonade API: READY ('+$lemonadeBase+')') -ForegroundColor Green
if($modelVisible){
  Write-Host ('BuyFlow model visible to n8n: YES -> '+$expectedModel) -ForegroundColor Green
}else{
  Write-Host ('BuyFlow model visible to n8n: NO -> '+$expectedModel) -ForegroundColor Red
}

# n8n local UI/API reachability only; no authenticated endpoint and no writes.
$n8nReachable=$false
try{
  $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 5
  $n8nReachable=$r.StatusCode -ge 200 -and $r.StatusCode -lt 500
}catch{}
Write-Host ('n8n localhost:5678 reachable: '+$n8nReachable) -ForegroundColor $(if($n8nReachable){'Green'}else{'Yellow'})

$pass=$hasChatNode -and $hasCredential -and $modelVisible
$summary=[ordered]@{
  checked_at=(Get-Date).ToString('o')
  read_only=$true
  n8n_version=$n8nVersion
  n8n_command=$n8nCmd.Source
  npm_global_root=$npmRoot
  lemonade_base_url=$lemonadeBase
  lemonade_chat_model_node_found=$hasChatNode
  lemonade_credential_found=$hasCredential
  expected_model=$expectedModel
  expected_model_visible=$modelVisible
  n8n_port_5678_reachable=$n8nReachable
  lemonade_node_files=@($lemonadeNodeFiles)
  lemonade_credential_files=@($lemonadeCredentialFiles)
  pass=$pass
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Yellow'})
if($pass){
  Write-Host 'N8N + LEMONADE PREFLIGHT: PASS' -ForegroundColor Green
  Write-Host 'Safe next step: create separate Lemonade credential + test workflow.' -ForegroundColor Green
}else{
  Write-Host 'N8N + LEMONADE PREFLIGHT: BLOCKED' -ForegroundColor Yellow
  Write-Host 'No changes were made. Use the details above to fix only the missing piece.' -ForegroundColor Yellow
}
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Workflow changes: 0 | Credentials changed: 0 | BuyFlow writes: 0' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Yellow'})

if(-not $pass){exit 2}
