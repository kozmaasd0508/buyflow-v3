$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stack = Join-Path $root 'infra\n8n-local'
$workflowDir = Join-Path $stack 'workflows'
$dataRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$runtimeRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime'
$envFile = Join-Path $dataRoot 'local.env'
$logFile = Join-Path $dataRoot 'n8n.log'
$errFile = Join-Path $dataRoot 'n8n.err.log'
$pidFile = Join-Path $dataRoot 'n8n.pid'
$importMarker = Join-Path $dataRoot '.buyflow-workflows-imported-v1'
$n8nCmd = Join-Path $runtimeRoot 'node_modules\.bin\n8n.cmd'
$model = 'qwen3:8b'

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Fail([string]$message) {
    Write-Host ''
    Write-Host "HIBA: $message" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Ne talalgass. Kuldd el nekem ennek az ablaknak az utolso 20 sorat.'
    Read-Host 'Nyomj Entert a bezarashoz'
    exit 1
}

function Test-Http([string]$url, [int]$timeout = 3) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeout
        return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
    } catch {
        return $false
    }
}

Write-Host ''
Write-Host '========================================'
Write-Host 'BUYFLOW LOCAL AI'
Write-Host 'Windows n8n + Windows Ollama'
Write-Host 'Docker NEM szukseges'
Write-Host '========================================'
Write-Host ''

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node) { Fail 'node.exe nem talalhato. A Windows Node.js szukseges.' }
if (-not $npm) { Fail 'npm.cmd nem talalhato. A Windows Node.js/npm szukseges.' }

$nodeVersionRaw = (& node.exe --version).Trim()
Write-Host "Node: $nodeVersionRaw"
try {
    $nodeVersion = [version]($nodeVersionRaw.TrimStart('v'))
    if ($nodeVersion.Major -lt 20) { Fail "Tul regi Node.js: $nodeVersionRaw. n8n-hez modern Node.js kell." }
} catch {
    Fail "Nem tudom ertelmezni a Node.js verziot: $nodeVersionRaw"
}

$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) { Fail 'ollama.exe nem talalhato a PATH-ban.' }

if (-not (Test-Http 'http://127.0.0.1:11434/api/tags' 2)) {
    Write-Host 'Ollama inditasa...'
    Start-Process -FilePath 'ollama.exe' -ArgumentList @('serve') -WindowStyle Hidden | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        if (Test-Http 'http://127.0.0.1:11434/api/tags' 2) { break }
    } while ((Get-Date) -lt $deadline)
    if (-not (Test-Http 'http://127.0.0.1:11434/api/tags' 2)) { Fail 'Ollama API nem indult el a 127.0.0.1:11434 cimen.' }
}
Write-Host 'Ollama: OK'

$list = (& ollama.exe list 2>&1 | Out-String)
if ($list -notmatch [regex]::Escape($model)) {
    Write-Host "$model nincs helyben. Letoltes indul..."
    & ollama.exe pull $model
    if ($LASTEXITCODE -ne 0) { Fail "$model letoltese sikertelen." }
}
Write-Host "Modell: $model OK"

if (-not (Test-Path $envFile)) {
    Write-Host 'Elso inditas: helyi n8n titkositasi kulcs generalasa...'
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
$env:GENERIC_TIMEZONE = 'Europe/Budapest'
$env:TZ = 'Europe/Budapest'
$env:DB_TYPE = 'sqlite'
$env:DB_SQLITE_POOL_SIZE = '2'
$env:BUYFLOW_OLLAMA_URL = 'http://127.0.0.1:11434/api/chat'
$env:BUYFLOW_OLLAMA_MODEL = $model
$env:BUYFLOW_AI_EXECUTE = 'false'

if (-not (Test-Path $n8nCmd)) {
    Write-Host ''
    Write-Host 'n8n nincs meg helyben. Elso telepites indul...'
    Write-Host '(Ez nehany percig tarthat, csak egyszer kell.)'
    & npm.cmd install --prefix $runtimeRoot n8n@latest --no-audit --no-fund
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $n8nCmd)) { Fail 'n8n npm telepitese sikertelen.' }
}

$n8nVersion = (& $n8nCmd --version 2>&1 | Out-String).Trim()
Write-Host "n8n: $n8nVersion"

$decisionWorkflow = Join-Path $workflowDir 'buyflow-local-ai-decision.json'
$teacherWorkflow = Join-Path $workflowDir 'buyflow-teacher-chat.json'
if (-not (Test-Path $decisionWorkflow)) { Fail "Workflow hianyzik: $decisionWorkflow" }
if (-not (Test-Path $teacherWorkflow)) { Fail "Workflow hianyzik: $teacherWorkflow" }

if (-not (Test-Path $importMarker)) {
    Write-Host 'BuyFlow workflow-k importalasa...'
    & $n8nCmd import:workflow --input=$decisionWorkflow
    if ($LASTEXITCODE -ne 0) { Fail 'AI Decision workflow import sikertelen.' }
    & $n8nCmd import:workflow --input=$teacherWorkflow
    if ($LASTEXITCODE -ne 0) { Fail 'Teacher Chat workflow import sikertelen.' }
    Set-Content -Path $importMarker -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Encoding ASCII
}

if (Test-Http 'http://127.0.0.1:5678/healthz' 2) {
    Write-Host 'n8n mar fut: OK'
    Start-Process 'http://127.0.0.1:5678'
    exit 0
}

Write-Host ''
Write-Host 'n8n inditasa Windows alatt...'
Set-Content -Path $logFile -Value '' -Encoding UTF8
Set-Content -Path $errFile -Value '' -Encoding UTF8

$proc = Start-Process -FilePath $n8nCmd -ArgumentList @('start') -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
Set-Content -Path $pidFile -Value $proc.Id -Encoding ASCII

$deadline = (Get-Date).AddMinutes(3)
do {
    Start-Sleep -Seconds 2
    if (Test-Http 'http://127.0.0.1:5678/healthz' 2) { break }
    if ($proc.HasExited) {
        $err = if (Test-Path $errFile) { (Get-Content $errFile -Tail 60 | Out-String) } else { '' }
        $out = if (Test-Path $logFile) { (Get-Content $logFile -Tail 60 | Out-String) } else { '' }
        Fail "n8n leallt indulas kozben.`n$err`n$out"
    }
} while ((Get-Date) -lt $deadline)

if (-not (Test-Http 'http://127.0.0.1:5678/healthz' 2)) {
    $err = if (Test-Path $errFile) { (Get-Content $errFile -Tail 60 | Out-String) } else { '' }
    Fail "n8n 3 percen belul nem lett elerheto.`n$err"
}

Write-Host ''
Write-Host '========================================'
Write-Host 'BUYFLOW LOCAL AI KESZ' -ForegroundColor Green
Write-Host '========================================'
Write-Host 'n8n: http://127.0.0.1:5678'
Write-Host "Ollama: $model"
Write-Host 'Adattar: helyi SQLite'
Write-Host 'Mod: SHADOW - BuyFlow adatbazis iras kikapcsolva'
Write-Host 'AI valasz utan Ollama keep_alive=0 -> modell unload'
Write-Host ''
Write-Host 'Elso alkalommal az n8n bongeszoben helyi tulajdonosi fiokot kerhet.'
Write-Host ''
Start-Process 'http://127.0.0.1:5678'
exit 0
