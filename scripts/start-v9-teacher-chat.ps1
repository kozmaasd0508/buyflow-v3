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

function Test-V9Run([string]$RunDir) {
  try {
    $metricsPath = Join-Path $RunDir 'metrics.json'
    $weights = Join-Path $RunDir 'best\adapter_model.safetensors'
    $config = Join-Path $RunDir 'best\adapter_config.json'
    if (-not ((Test-Path $metricsPath) -and (Test-Path $weights) -and (Test-Path $config))) { return $false }
    $metrics = Get-Content -Raw -Path $metricsPath | ConvertFrom-Json
    return (
      $metrics.status -eq 'LORA_V9_TEACHER_DIALOGUE_CORRECTION_TRAIN_COMPLETE' -and
      $metrics.locked_test_read -eq $false -and
      $metrics.locked_test_trained -eq $false
    )
  } catch {
    return $false
  }
}

function Find-V9ServerScript([string]$ProjectRoot, [string]$SearchRoot) {
  $candidates = New-Object System.Collections.Generic.List[string]
  $preferred = Join-Path $ProjectRoot '.codex-worktrees\teacher-corpus-v6\scripts\lora-wsl-shadow-server-v9-safe.py'
  $candidates.Add($preferred)
  $candidates.Add((Join-Path $ProjectRoot 'scripts\lora-wsl-shadow-server-v9-safe.py'))

  $worktrees = Join-Path $ProjectRoot '.codex-worktrees'
  if (Test-Path $worktrees) {
    foreach ($dir in Get-ChildItem -Path $worktrees -Directory -ErrorAction SilentlyContinue) {
      $candidate = Join-Path $dir.FullName 'scripts\lora-wsl-shadow-server-v9-safe.py'
      if (-not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
    }
  }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $siblingV6 = Join-Path (Split-Path $candidate -Parent) 'lora-wsl-shadow-server-v6-safe.py'
      if (Test-Path $siblingV6) { return $candidate }
    }
  }

  $found = Get-ChildItem -Path $SearchRoot -Recurse -File -Filter 'lora-wsl-shadow-server-v9-safe.py' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.Directory.FullName 'lora-wsl-shadow-server-v6-safe.py') } |
    Select-Object -First 1
  if ($found) { return $found.FullName }

  throw "Nem talaltam hasznalhato V9 safe server scriptet a BuyFlow mappakban."
}

function Find-V9Run([string]$SearchRoot) {
  $exactName = '20260829T155503Z-qwen3-8b-buyflow-v9-teacher-dialogue-correction-classifier'
  $exact = Get-ChildItem -Path $SearchRoot -Recurse -Directory -Filter $exactName -ErrorAction SilentlyContinue |
    Where-Object { Test-V9Run $_.FullName } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($exact) { return $exact.FullName }

  $matching = Get-ChildItem -Path $SearchRoot -Recurse -Directory -Filter '*buyflow-v9-teacher-dialogue-correction-classifier*' -ErrorAction SilentlyContinue |
    Where-Object { Test-V9Run $_.FullName } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($matching) { return $matching.FullName }

  throw "Nem talaltam a befejezett V9 training run-t a $SearchRoot mappa alatt. A modell sulyait nem toroljuk es nem talalgatunk helyettuk."
}

try {
  Remove-Item $errorReport -Force -ErrorAction SilentlyContinue
  Set-Content -Path $launcherLog -Value ("BuyFlow AI startup {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
  Set-Content -Path $modelOutLog -Value '' -Encoding UTF8
  Set-Content -Path $modelErrLog -Value '' -Encoding UTF8
  Set-Content -Path $uiOutLog -Value '' -Encoding UTF8
  Set-Content -Path $uiErrLog -Value '' -Encoding UTF8

  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $searchRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow'
  $projectRoot = Join-Path $searchRoot '01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'
  $uiScript = Join-Path $repoRoot 'scripts\v9-teacher-chat-ui.py'
  $explicitServer = Join-Path $repoRoot 'scripts\lora-v9-explicit-run-server.py'

  if (-not (Test-Path $searchRoot)) { throw "Nem talalom a BuyFlow gyokermappat: $searchRoot" }
  if (-not (Test-Path $projectRoot)) { throw "Nem talalom a BuyFlow projektet: $projectRoot" }
  if (-not (Test-Path $uiScript)) { throw "Nem talalom a Tanari Chat UI-t: $uiScript" }
  if (-not (Test-Path $explicitServer)) { throw "Nem talalom az explicit V9 launcher scriptet: $explicitServer" }
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'A wsl.exe nem erheto el.' }

  Log 'V9 safe server forras keresese...'
  $v9ServerScript = Find-V9ServerScript $projectRoot $searchRoot
  Log "V9 server: $v9ServerScript"

  Log 'Befejezett V9 training run keresese...'
  $v9Run = Find-V9Run $searchRoot
  Log "V9 run: $v9Run"

  $repoWsl = To-WslPath $repoRoot
  $serverWsl = To-WslPath $v9ServerScript
  $runWsl = To-WslPath $v9Run

  Log '===== BUYFLOW V9 TANARI CHAT ====='

  $health = Test-JsonEndpoint 'http://127.0.0.1:4392/health'
  if ($health -and $health.ok -and $health.ready -and $health.provider -eq 'lora-v9') {
    Log 'V9 modellszerver mar fut.'
  } else {
    Log 'V9 modellszerver inditasa explicit training run-bol...'
    $modelCommand = "cd '$repoWsl' && exec python3 scripts/lora-v9-explicit-run-server.py '$serverWsl' '$runWsl'"
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
