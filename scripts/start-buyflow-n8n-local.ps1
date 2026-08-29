$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workflowDir = Join-Path $root 'infra\n8n-local\workflows'
$dataRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$runtimeRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime'
$envFile = Join-Path $dataRoot 'local.env'
$logFile = Join-Path $dataRoot 'n8n.log'
$errFile = Join-Path $dataRoot 'n8n.err.log'
$pidFile = Join-Path $dataRoot 'n8n.pid'
$importMarker = Join-Path $dataRoot '.buyflow-workflows-imported-v2'
$model = 'qwen3:8b'
$buyflowNodeVersion = '24.20.0'
$n8nVersion = '2.37.3'
$nodeDirName = "node-v$buyflowNodeVersion-win-x64"
$nodeHome = Join-Path $dataRoot $nodeDirName
$nodeExe = Join-Path $nodeHome 'node.exe'
$npmCmd = Join-Path $nodeHome 'npm.cmd'
$n8nBin = Join-Path $runtimeRoot 'node_modules\n8n\bin\n8n'

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Fail([string]$message) {
    Write-Host ''
    Write-Host "HIBA: $message" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Kuldd el ennek az ablaknak az utolso 20 sorat.'
    Read-Host 'Nyomj Entert a bezarashoz'
    exit 1
}

function Test-Http200([string]$url, [int]$timeout = 3) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeout
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Stop-TrackedN8n {
    if (-not (Test-Path $pidFile)) { return }
    try {
        $raw = (Get-Content $pidFile -Raw).Trim()
        if ($raw -match '^\d+$') {
            $p = Get-Process -Id ([int]$raw) -ErrorAction SilentlyContinue
            if ($p) {
                Write-Host "n8n leallitasa a workflow-frissiteshez (PID $raw)..."
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }
        }
    } catch {}
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Ensure-BuyFlowNode {
    if ((Test-Path $nodeExe) -and (Test-Path $npmCmd)) { return }
    Write-Host "BuyFlow sajat Node.js $buyflowNodeVersion runtime letoltese..."
    $zip = Join-Path $env:TEMP "$nodeDirName.zip"
    $url = "https://nodejs.org/dist/v$buyflowNodeVersion/$nodeDirName.zip"
    try {
        if (Test-Path $zip) { Remove-Item -Force $zip }
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -TimeoutSec 180
        Expand-Archive -Path $zip -DestinationPath $dataRoot -Force
    } catch {
        Fail "BuyFlow Node letoltese sikertelen: $($_.Exception.Message)"
    } finally {
        if (Test-Path $zip) { Remove-Item -Force $zip -ErrorAction SilentlyContinue }
    }
    if (-not (Test-Path $nodeExe)) { Fail 'A BuyFlow Node runtime nem jott letre.' }
}

Write-Host ''
Write-Host '========================================'
Write-Host 'BUYFLOW LOCAL AI'
Write-Host 'Windows n8n + Windows Ollama'
Write-Host '========================================'
Write-Host ''

Ensure-BuyFlowNode
$env:PATH = "$nodeHome;$env:PATH"
Write-Host "BuyFlow Node: $((& $nodeExe --version 2>&1 | Out-String).Trim())"

$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) { Fail 'ollama.exe nem talalhato.' }
if (-not (Test-Http200 'http://127.0.0.1:11434/api/tags' 2)) {
    Write-Host 'Ollama inditasa...'
    Start-Process -FilePath 'ollama.exe' -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        if (Test-Http200 'http://127.0.0.1:11434/api/tags' 2) { break }
    } while ((Get-Date) -lt $deadline)
}
if (-not (Test-Http200 'http://127.0.0.1:11434/api/tags' 2)) { Fail 'Ollama API nem indult el.' }
Write-Host 'Ollama: OK'

$list = (& ollama.exe list 2>&1 | Out-String)
if ($list -notmatch [regex]::Escape($model)) {
    & ollama.exe pull $model
    if ($LASTEXITCODE -ne 0) { Fail "$model letoltese sikertelen." }
}
Write-Host "Modell: $model OK"

if (-not (Test-Path $envFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $key = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
    @(
        "N8N_ENCRYPTION_KEY=$key",
        'BUYFLOW_OLLAMA_URL=http://127.0.0.1:11434/api/chat',
        'BUYFLOW_OLLAMA_MODEL=qwen3:8b',
        'BUYFLOW_AI_EXECUTE=false'
    ) | Set-Content -Path $envFile -Encoding ASCII
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

$env:N8N_USER_FOLDER = $dataRoot
$env:N8N_HOST = '127.0.0.1'
$env:N8N_PORT = '5678'
$env:N8N_PROTOCOL = 'http'
$env:N8N_EDITOR_BASE_URL = 'http://127.0.0.1:5678'
$env:WEBHOOK_URL = 'http://127.0.0.1:5678/'
$env:N8N_SECURE_COOKIE = 'false'
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
$env:N8N_PERSONALIZATION_ENABLED = 'false'
$env:N8N_VERSION_NOTIFICATIONS_ENABLED = 'false'
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false'
$env:GENERIC_TIMEZONE = 'Europe/Budapest'
$env:TZ = 'Europe/Budapest'
$env:DB_TYPE = 'sqlite'
$env:DB_SQLITE_POOL_SIZE = '2'
$env:BUYFLOW_OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'
$env:BUYFLOW_OLLAMA_MODEL = $model
$env:BUYFLOW_AI_EXECUTE = 'false'

if (-not (Test-Path $n8nBin)) {
    Write-Host "n8n $n8nVersion telepitese..."
    & $npmCmd install --prefix $runtimeRoot "n8n@$n8nVersion" --no-audit --no-fund
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $n8nBin)) { Fail 'n8n telepitese sikertelen.' }
}
$installed = (& $nodeExe $n8nBin --version 2>&1 | Out-String).Trim()
Write-Host "n8n: $installed"
if ($installed -ne $n8nVersion) { Fail "Varatlan n8n verzio: $installed" }

$decisionWorkflow = Join-Path $workflowDir 'buyflow-local-ai-decision.json'
$teacherWorkflow = Join-Path $workflowDir 'buyflow-teacher-chat.json'
if (-not (Test-Path $decisionWorkflow)) { Fail 'AI Decision workflow hianyzik.' }
if (-not (Test-Path $teacherWorkflow)) { Fail 'Teacher Chat workflow hianyzik.' }

# v2 marker means the stricter lifecycle prompt has already been imported.
if (-not (Test-Path $importMarker)) {
    Stop-TrackedN8n
    if (Test-Http200 'http://127.0.0.1:5678/healthz' 2) {
        Fail 'Az n8n meg fut, ezert nem frissitem menet kozben az SQLite adatbazist. Zarj be minden regi BuyFlow n8n ablakot es inditsd ujra ezt.'
    }

    Write-Host 'BuyFlow AI workflow frissitese: shipment-boundary-v2...'
    & $nodeExe $n8nBin import:workflow --input=$decisionWorkflow
    if ($LASTEXITCODE -ne 0) { Fail 'AI Decision workflow frissitese sikertelen.' }
    & $nodeExe $n8nBin import:workflow --input=$teacherWorkflow
    if ($LASTEXITCODE -ne 0) { Fail 'Teacher Chat workflow frissitese sikertelen.' }

    & $nodeExe $n8nBin publish:workflow --id=bf-local-ai-decision-v1
    if ($LASTEXITCODE -ne 0) { Fail 'AI Decision workflow publikalasa sikertelen.' }
    & $nodeExe $n8nBin publish:workflow --id=bf-teacher-chat-v1
    if ($LASTEXITCODE -ne 0) { Fail 'Teacher Chat workflow publikalasa sikertelen.' }
    Set-Content -Path $importMarker -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Encoding ASCII
}

if (Test-Http200 'http://127.0.0.1:5678/' 2) {
    Write-Host 'n8n web UI mar fut: OK'
    Start-Process 'http://127.0.0.1:5678'
    exit 0
}

Write-Host 'n8n inditasa...'
Set-Content -Path $logFile -Value '' -Encoding UTF8
Set-Content -Path $errFile -Value '' -Encoding UTF8
$proc = Start-Process -FilePath $nodeExe -ArgumentList @($n8nBin, 'start') -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
Set-Content -Path $pidFile -Value $proc.Id -Encoding ASCII

$deadline = (Get-Date).AddMinutes(5)
$healthSeen = $false
do {
    Start-Sleep -Seconds 3
    if (Test-Http200 'http://127.0.0.1:5678/' 3) { break }
    if (-not $healthSeen -and (Test-Http200 'http://127.0.0.1:5678/healthz' 2)) {
        Write-Host 'healthz OK, a web UI meg inicializal...'
        $healthSeen = $true
    }
    if ($proc.HasExited) {
        $err = if (Test-Path $errFile) { (Get-Content $errFile -Tail 80 | Out-String) } else { '' }
        $out = if (Test-Path $logFile) { (Get-Content $logFile -Tail 80 | Out-String) } else { '' }
        Fail "n8n leallt indulas kozben.`n$err`n$out"
    }
} while ((Get-Date) -lt $deadline)

if (-not (Test-Http200 'http://127.0.0.1:5678/' 3)) {
    $err = if (Test-Path $errFile) { (Get-Content $errFile -Tail 80 | Out-String) } else { '' }
    Fail "A web UI 5 percen belul nem lett kesz.`n$err"
}

Write-Host ''
Write-Host '========================================'
Write-Host 'BUYFLOW LOCAL AI KESZ' -ForegroundColor Green
Write-Host '========================================'
Write-Host 'n8n: http://127.0.0.1:5678'
Write-Host 'Mod: SHADOW'
Write-Host 'Lifecycle szabaly: shipment-boundary-v2'
Write-Host ''
Start-Process 'http://127.0.0.1:5678'
exit 0
