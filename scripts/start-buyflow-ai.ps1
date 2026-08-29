$ErrorActionPreference = 'Stop'

function Get-V9Health {
  try {
    return Invoke-RestMethod -Uri 'http://127.0.0.1:4392/health' -Method Get -TimeoutSec 2
  } catch {
    return $null
  }
}

function Get-TeacherUiResponse {
  try {
    return Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4393/' -TimeoutSec 2
  } catch {
    return $null
  }
}

function Stop-LegacyTeacherUi {
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'A regi Tanari Chat UI fut, de a wsl.exe nem erheto el a celzott leallitashoz.'
  }
  & wsl.exe bash -lc "pkill -f '[v]9-teacher-chat-ui.py' || true" | Out-Null
  Start-Sleep -Seconds 1
}

$uiResponse = Get-TeacherUiResponse
if ($uiResponse -and $uiResponse.StatusCode -eq 200) {
  $serverHeader = [string]$uiResponse.Headers['Server']
  if ($serverHeader -match 'BuyFlowTeacherChatUI/1\.1') {
    Start-Process 'http://127.0.0.1:4393'
    exit 0
  }

  # Old 1.0 UI stays alive after the browser tab is closed. Remove only that
  # specific teacher UI process, then recycle the matching V9 server below.
  Write-Host "Regi Tanari Chat UI talalva ($serverHeader), celzott leallitas..."
  Stop-LegacyTeacherUi
}

# Migration/repair path: an older launcher could leave V9 alive after the browser
# UI disappeared. Recycle that stale process before starting the current UI so
# the new local /shutdown + presence lifecycle is guaranteed to be active.
$health = Get-V9Health
if ($health -and $health.ok -and $health.provider -eq 'lora-v9') {
  Write-Host 'Regi/bent maradt V9 modellszerver leallitasa...'

  try {
    Invoke-RestMethod `
      -Uri 'http://127.0.0.1:4392/shutdown' `
      -Method Post `
      -Headers @{ 'X-BuyFlow-Shutdown' = 'teacher-ui-v1' } `
      -ContentType 'application/json' `
      -Body '{}' `
      -TimeoutSec 4 | Out-Null
  } catch {
    # Older V9 builds do not have /shutdown. Fall through to the narrowly scoped
    # process cleanup below; never use a blanket wsl --shutdown here.
  }

  $deadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 500
    $health = Get-V9Health
    if (-not $health) { break }
  } while ((Get-Date) -lt $deadline)

  if ($health) {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
      throw 'A regi V9 fut, de a wsl.exe nem erheto el a celzott leallitashoz.'
    }

    # Regex character class prevents pkill from matching its own command line.
    & wsl.exe bash -lc "pkill -f '[l]ora-v9-explicit-run-server.py|[l]ora-wsl-shadow-server-v9-safe.py' || true" | Out-Null
    Start-Sleep -Seconds 2
    $health = Get-V9Health
    if ($health) {
      throw 'A bent maradt V9 modellszervert nem sikerult biztonsagosan leallitani.'
    }
  }
}

$launcher = Join-Path $PSScriptRoot 'start-v9-teacher-chat.ps1'
if (-not (Test-Path $launcher)) {
  throw "Nem talalom a BuyFlow AI launcher scriptet: $launcher"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
exit $LASTEXITCODE
