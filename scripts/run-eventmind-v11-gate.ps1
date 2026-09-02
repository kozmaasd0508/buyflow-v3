$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Split-Path -Parent $here
$distro = 'Ubuntu-24.04'
$server = Join-Path $here 'eventmind-v11-runtime.py'
$fixture = Join-Path $project 'local-data\eventmind-v11-representation-gate\untouched-v1.jsonl'
$runtimeRoot = Join-Path $project 'local-data\eventmind-v11-runtime'
$stdout = Join-Path $runtimeRoot 'server.out.log'
$stderr = Join-Path $runtimeRoot 'server.err.log'
$serverPid = $null
$finalExit = 0

function Convert-ToWslPath([string]$p) {
    $full = [System.IO.Path]::GetFullPath($p)
    if ($full -notmatch '^([A-Za-z]):\\(.*)$') { throw "WSL_PATH_UNSUPPORTED: $full" }
    $drive = $Matches[1].ToLowerInvariant()
    $rest = $Matches[2].Replace('\','/')
    return "/mnt/$drive/$rest"
}

function Stop-EventMindServer {
    if ($serverPid) {
        & wsl.exe -d $distro -- sh -lc "kill $serverPid 2>/dev/null || true" | Out-Null
    } else {
        & wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v11-runtime.py' || true" | Out-Null
    }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW EVENTMIND V11 - FRISS TESZT' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'Ez nem tanítja a modellt és semmit nem kapcsol élesre.' -ForegroundColor Green
Write-Host ''

if (-not (Test-Path $project)) { throw "PROJECT_NOT_FOUND: $project" }
if (-not (Test-Path $server)) { throw "EVENTMIND_SERVER_NOT_FOUND: $server" }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL_NOT_FOUND' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'NPM_NOT_FOUND' }

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$wslProject = Convert-ToWslPath $project
$wslServer = Convert-ToWslPath $server
$wslStdout = Convert-ToWslPath $stdout
$wslStderr = Convert-ToWslPath $stderr
$wslHome = (& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
if ([string]::IsNullOrWhiteSpace($wslHome)) { throw 'WSL_HOME_NOT_FOUND' }
$wslPython = "$wslHome/.venvs/buyflow-lora/bin/python"
& wsl.exe -d $distro -- test -x $wslPython
if ($LASTEXITCODE -ne 0) { throw "LORA_PYTHON_NOT_FOUND: $wslPython" }

Push-Location $project
try {
    Write-Host '[1/4] Új, egyszer használható tesztcsomag elkészítése...' -ForegroundColor Yellow
    & npm.cmd run eventmind:v11-gate-fixture --workspace '@buyflow/api' -- $fixture
    if ($LASTEXITCODE -ne 0) { throw 'EVENTMIND_FIXTURE_CREATE_FAILED' }

    Write-Host ''
    Write-Host '[2/4] V11 modell biztonságos helyi indítása...' -ForegroundColor Yellow
    Stop-EventMindServer
    Remove-Item $stdout,$stderr -Force -ErrorAction SilentlyContinue
    $launch = "nohup env HSA_ENABLE_DXG_DETECTION=1 TOKENIZERS_PARALLELISM=false '$wslPython' '$wslServer' '$wslProject' > '$wslStdout' 2> '$wslStderr' < /dev/null & echo `$!"
    $serverPid = (& wsl.exe -d $distro -- bash -lc $launch).Trim()
    if ($serverPid -notmatch '^\d+$') { throw "EVENTMIND_SERVER_PID_INVALID: $serverPid" }

    $health = $null
    for ($i = 0; $i -lt 180; $i++) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4394/health' -Method Get -TimeoutSec 2
            if ($health.ok) { break }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $health -or -not $health.ok) {
        Write-Host 'A V11 szerver nem indult el.' -ForegroundColor Red
        if (Test-Path $stderr) { Get-Content $stderr -Tail 30 }
        throw 'EVENTMIND_V11_RUNTIME_START_FAILED'
    }
    if ($health.model_id -ne 'Qwen/Qwen3-8B') { throw "EVENTMIND_MODEL_MISMATCH: $($health.model_id)" }
    if ($health.thinking_enabled -ne $false) { throw 'EVENTMIND_THINKING_NOT_DISABLED' }
    if ($health.deterministic -ne $true) { throw 'EVENTMIND_NOT_DETERMINISTIC' }
    if ([string]::IsNullOrWhiteSpace([string]$health.adapter_sha256) -or ([string]$health.adapter_sha256) -notmatch '^[a-fA-F0-9]{64}$') {
        throw 'EVENTMIND_ADAPTER_SHA_INVALID'
    }
    Write-Host "V11 adapter SHA: $($health.adapter_sha256)" -ForegroundColor Green

    Write-Host ''
    Write-Host '[3/4] Friss MailLens/EventMind teszt futtatása...' -ForegroundColor Yellow
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED = 'true'
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL = 'http://127.0.0.1:4394/v1/eventmind'
    $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 = [string]$health.adapter_sha256
    $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS = '30000'
    & npm.cmd run eventmind:v11-gate --workspace '@buyflow/api' -- $fixture
    $gateExit = $LASTEXITCODE

    Write-Host ''
    Write-Host '[4/4] Kész.' -ForegroundColor Yellow
    if ($gateExit -eq 0) {
        Write-Host 'EVENTMIND V11 FRISS TESZT: PASS' -ForegroundColor Green
    } elseif ($gateExit -eq 2) {
        Write-Host 'EVENTMIND V11 FRISS TESZT: FAIL' -ForegroundColor Red
        $finalExit = 2
    } else {
        throw "EVENTMIND_V11_GATE_ERROR: $gateExit"
    }
} finally {
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS -ErrorAction SilentlyContinue
    Stop-EventMindServer
    Pop-Location
}

exit $finalExit
