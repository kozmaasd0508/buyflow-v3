$ErrorActionPreference = 'Stop'

$logDir = Join-Path $env:LOCALAPPDATA 'BuyFlowAI\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$launcherLog = Join-Path $logDir 'startup.log'
$modelOutLog = Join-Path $logDir 'model.stdout.log'
$modelErrLog = Join-Path $logDir 'model.stderr.log'
$uiOutLog = Join-Path $logDir 'ui.stdout.log'
$uiErrLog = Join-Path $logDir 'ui.stderr.log'
$errorReport = Join-Path $logDir 'LAST-ERROR.txt'

function Log([string]$Message) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $launcherLog -Value $line -Encoding UTF8
  Write-Host $Message
}

function Tail([string]$Path, [int]$Lines = 80) {
  if (-not (Test-Path $Path)) { return '(nincs log)' }
  return ((Get-Content -Path $Path -Tail $Lines -ErrorAction SilentlyContinue) -join [Environment]::NewLine)
}

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

function Find-V9RepoRoot([string]$ProjectRoot) {
  $candidates = New-Object System.Collections.Generic.List[string]
  $preferred = Join-Path $ProjectRoot '.codex-worktrees\teacher-corpus-v6'
  $candidates.Add($preferred)
  $candidates.Add($ProjectRoot)

  $worktrees = Join-Path $ProjectRoot '.codex-worktrees'
  if (Test-Path $worktrees) {
    foreach ($dir in Get-ChildItem -Path $worktrees -Directory -ErrorAction SilentlyContinue) {
      if (-not $candidates.Contains($dir.FullName)) { $candidates.Add($dir.FullName) }
    }
  }

  foreach ($candidate in $candidates) {
    $script = Join-Path $candidate 'scripts\lora-wsl-shadow-server-v9-safe.py'
    $latest = Join-Path $candidate 'local-data\lora-v7\LATEST.txt'
    if ((Test-Path $script) -and (Test-Path $latest)) {
      return $candidate
    }
  }

  $checked = ($candidates | ForEach-Object { " - $_" }) -join [Environment]::NewLine
  throw "Nem talaltam olyan BuyFlow worktree-t, ahol a V9 szerver es a local-data\lora-v7\LATEST.txt is megvan. Ellenorzott helyek:`n$checked"
}

try {
  Remove-Item $errorReport -Force -ErrorAction SilentlyContinue
  Set-Content -Path $launcherLog -Value ("BuyFlow AI startup {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
  Set-Content -Path $modelOutLog -Value '' -Encoding UTF8
  Set-Content -Path $modelErrLog -Value '' -Encoding UTF8
  Set-Content -Path $uiOutLog -Value '' -Encoding UTF8
  Set-Content -Path $uiErrLog -Value '' -Encoding UTF8

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $projectRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'
  $uiScript = Join-Path $repoRoot 'scripts\v9-teacher-chat-ui.py'

  if (-not (Test-Path $projectRoot)) { throw "Nem talalom a BuyFlow projektet: $projectRoot" }
  if (-not (Test-Path $uiScript)) { throw "Nem talalom a Tanari Chat UI-t: $uiScript" }
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'A wsl.exe nem erheto el.' }

  $v9Root = Find-V9RepoRoot $projectRoot
  $modelScript = Join-Path $v9Root 'scripts\lora-wsl-shadow-server-v9-safe.py'
  Log "V9 repo: $v9Root"

  $v9Wsl = To-WslPath $v9Root
  $repoWsl = To-WslPath $repoRoot

  Log '===== BUYFLOW V9 TANARI CHAT ====='

  $health = Test-JsonEndpoint 'http://127.0.0.1:4392/health'
  if ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9') {
    Log 'V9 modellszerver mar fut.'
  } else {
    Log 'V9 modellszerver inditasa...'
    $modelCommand = "cd '$v9Wsl' && exec python3 scripts/lora-wsl-shadow-server-v9-safe.py '$v9Wsl'"
    $modelProc = Start-Process -FilePath 'wsl.exe' -ArgumentList @('bash', '-lc', $modelCommand) -WindowStyle Hidden -RedirectStandardOutput $modelOutLog -RedirectStandardError $modelErrLog -PassThru

    $deadline = (Get-Date).AddMinutes(5)
    do {
      Start-Sleep -Seconds 2
      $health = Test-JsonEndpoint 'http://127.0.0.1:4392/health'
      if ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9') { break }
      if ($modelProc.HasExited) {
        $stderr = Tail $modelErrLog
        $stdout = Tail $modelOutLog
        throw "A V9 modellszerver leallt betoltes kozben (exit=$($modelProc.ExitCode)).`nMODEL STDERR:`n$stderr`nMODEL STDOUT:`n$stdout"
      }
    } while ((Get-Date) -lt $deadline)

    if (-not ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9')) {
      $stderr = Tail $modelErrLog
      $stdout = Tail $modelOutLog
      throw "A V9 modellszerver 5 percen belul nem lett kesz a 4392 porton.`nMODEL STDERR:`n$stderr`nMODEL STDOUT:`n$stdout"
    }
    Log 'V9 modellszerver kesz.'
  }

  $uiHealth = $null
  try { $uiHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4393/' -TimeoutSec 2 } catch {}

  if (-not $uiHealth -or $uiHealth.StatusCode -ne 200) {
    Log 'Tanari Chat felulet inditasa...'
    $uiCommand = "cd '$repoWsl' && exec python3 scripts/v9-teacher-chat-ui.py"
    $uiProc = Start-Process -FilePath 'wsl.exe' -ArgumentList @('bash', '-lc', $uiCommand) -WindowStyle Hidden -RedirectStandardOutput $uiOutLog -RedirectStandardError $uiErrLog -PassThru

    $deadlineUi = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Seconds 1
      try { $uiHealth = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4393/' -TimeoutSec 2 } catch { $uiHealth = $null }
      if ($uiHealth -and $uiHealth.StatusCode -eq 200) { break }
      if ($uiProc.HasExited) {
        throw "A Tanari Chat UI leallt indulas kozben (exit=$($uiProc.ExitCode)).`nUI STDERR:`n$(Tail $uiErrLog)`nUI STDOUT:`n$(Tail $uiOutLog)"
      }
    } while ((Get-Date) -lt $deadlineUi)

    if (-not $uiHealth -or $uiHealth.StatusCode -ne 200) {
      throw "A Tanari Chat UI nem indult el a 4393 porton.`nUI STDERR:`n$(Tail $uiErrLog)`nUI STDOUT:`n$(Tail $uiOutLog)"
    }
  }

  Log 'KESZ: http://127.0.0.1:4393'
  Start-Process 'http://127.0.0.1:4393'
  exit 0
} catch {
  $message = $_.Exception.Message
  Add-Content -Path $launcherLog -Value ("ERROR: $message") -Encoding UTF8
  $report = @"
BUYFLOW AI - INDULASI HIBA
Idopont: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

HIBA:
$message

--- STARTUP LOG ---
$(Tail $launcherLog 120)

--- MODEL STDERR ---
$(Tail $modelErrLog 120)

--- MODEL STDOUT ---
$(Tail $modelOutLog 120)

--- UI STDERR ---
$(Tail $uiErrLog 120)

--- UI STDOUT ---
$(Tail $uiOutLog 120)
"@
  Set-Content -Path $errorReport -Value $report -Encoding UTF8
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "A BuyFlow AI nem tudott elindulni.`n`nMegnyitom a hibajelentest.`n`n$errorReport",
      'BuyFlow AI - inditasi hiba',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  } catch {}
  Start-Process notepad.exe -ArgumentList @($errorReport)
  exit 1
}
