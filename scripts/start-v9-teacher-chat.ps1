$ErrorActionPreference = 'Stop'

function To-WslPath([string]$WindowsPath) {
  $full = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($full.Length -lt 3 -or $full[1] -ne ':') {
    throw "Nem Windows meghajto-utvonal: $full"
  }
  $drive = $full.Substring(0, 1).ToLowerInvariant()
  $rest = $full.Substring(2).Replace('\', '/')
  return "/mnt/$drive$rest"
}

function Test-JsonEndpoint([string]$Url) {
  try {
    return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
  } catch {
    return $null
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$teacherRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation\.codex-worktrees\teacher-corpus-v6'
$modelScript = Join-Path $teacherRoot 'scripts\lora-wsl-shadow-server-v9-safe.py'
$uiScript = Join-Path $repoRoot 'scripts\v9-teacher-chat-ui.py'

if (-not (Test-Path $teacherRoot)) { throw "Nem talalom a teacher worktree-t: $teacherRoot" }
if (-not (Test-Path $modelScript)) { throw "Nem talalom a V9 modellszervert: $modelScript" }
if (-not (Test-Path $uiScript)) { throw "Nem talalom a Tanari Chat UI-t: $uiScript" }

$teacherWsl = To-WslPath $teacherRoot
$repoWsl = To-WslPath $repoRoot

Write-Host ''
Write-Host '===== BUYFLOW V9 TANARI CHAT =====' -ForegroundColor Cyan

$health = Test-JsonEndpoint 'http://127.0.0.1:4392/health'
if ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9') {
  Write-Host 'V9 modellszerver mar fut.' -ForegroundColor Green
} else {
  Write-Host 'V9 modellszerver inditasa... (modellbetoltes eltarthat egy kicsit)' -ForegroundColor Yellow
  $modelCommand = "cd '$teacherWsl' && exec python3 scripts/lora-wsl-shadow-server-v9-safe.py '$teacherWsl'"
  Start-Process -FilePath 'wsl.exe' -ArgumentList @('bash', '-lc', $modelCommand) | Out-Null

  $deadline = (Get-Date).AddMinutes(5)
  do {
    Start-Sleep -Seconds 3
    $health = Test-JsonEndpoint 'http://127.0.0.1:4392/health'
    if ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9') { break }
    Write-Host '.' -NoNewline
  } while ((Get-Date) -lt $deadline)
  Write-Host ''

  if (-not ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9')) {
    throw 'A V9 modellszerver 5 percen belul nem lett kesz a 4392 porton.'
  }
  Write-Host 'V9 modellszerver kesz.' -ForegroundColor Green
}

$uiHealth = $null
try {
  $uiHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4393/' -TimeoutSec 2
} catch {}

if (-not $uiHealth -or $uiHealth.StatusCode -ne 200) {
  Write-Host 'Tanari Chat felulet inditasa...' -ForegroundColor Yellow
  $uiCommand = "cd '$repoWsl' && exec python3 scripts/v9-teacher-chat-ui.py"
  Start-Process -FilePath 'wsl.exe' -ArgumentList @('bash', '-lc', $uiCommand) | Out-Null

  $deadlineUi = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 1
    try {
      $uiHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4393/' -TimeoutSec 2
    } catch {
      $uiHealth = $null
    }
    if ($uiHealth -and $uiHealth.StatusCode -eq 200) { break }
  } while ((Get-Date) -lt $deadlineUi)

  if (-not $uiHealth -or $uiHealth.StatusCode -ne 200) {
    throw 'A Tanari Chat UI nem indult el a 4393 porton.'
  }
}

Write-Host ''
Write-Host 'KESZ: http://127.0.0.1:4393' -ForegroundColor Green
Write-Host 'Beszelgetesi mod: V9 /teacher-chat, classifier adapter kikapcsolva.' -ForegroundColor DarkGray
Write-Host 'A chat nem ir automatikusan tanitoadatot.' -ForegroundColor DarkGray
Start-Process 'http://127.0.0.1:4393'
