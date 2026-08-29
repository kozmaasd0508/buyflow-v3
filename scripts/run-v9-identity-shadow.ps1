$ErrorActionPreference = 'Stop'

function Run-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Host ""
  Write-Host "===== $Name =====" -ForegroundColor Cyan
  & $Command
  $code = $LASTEXITCODE
  if ($null -ne $code -and $code -ne 0) {
    throw "$Name FAIL - exit code: $code"
  }
  Write-Host "$Name PASS" -ForegroundColor Green
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

$teacher = Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation\.codex-worktrees\teacher-corpus-v6'
$envFile = Join-Path $teacher '.env.local'
if (-not (Test-Path $envFile)) {
  throw "Nem talalom a staging env fajlt: $envFile"
}

$env:BUYFLOW_ENV_FILE = $envFile
$env:BUYFLOW_V9_IDENTITY_REPORT = Join-Path $repoRoot 'BUYFLOW-V9-REAL-GMAIL-IDENTITY-SHADOW.json'

Run-Step 'API TYPECHECK' {
  npm.cmd run typecheck
}

Run-Step 'V9 REAL GMAIL IDENTITY SHADOW' {
  npm.cmd run identity:v9-real-gmail-shadow --workspace '@buyflow/api'
}

Write-Host ""
Write-Host '========================================' -ForegroundColor Green
Write-Host 'V9 SHADOW RUN COMPLETE' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host "REPORT: $env:BUYFLOW_V9_IDENTITY_REPORT" -ForegroundColor Yellow
