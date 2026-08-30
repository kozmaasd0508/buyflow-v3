param(
    [string]$MessageId = '1a04738dd7b7f0b2'
)

$ErrorActionPreference = 'Stop'

$dataRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$runtimeRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime'
$nodeHome = Join-Path $dataRoot 'node-v24.20.0-win-x64'
$nodeExe = Join-Path $nodeHome 'node.exe'
$n8nBin = Join-Path $runtimeRoot 'node_modules\n8n\bin\n8n'
$envFile = Join-Path $dataRoot 'local.env'
$pidFile = Join-Path $dataRoot 'n8n.pid'
$logFile = Join-Path $dataRoot 'n8n.log'
$errFile = Join-Path $dataRoot 'n8n.err.log'
$sourceId = 'bf-gmail-shadow-intake-v1'
$targetId = 'bf-gmail-targeted-test-v2'
$targetTemplate = Join-Path $env:TEMP 'buyflow-gmail-targeted-test-v2.json'
$tempSource = Join-Path $env:TEMP 'buyflow-gmail-source-export-v2.json'
$tempTarget = Join-Path $env:TEMP 'buyflow-gmail-targeted-import-v2.json'
$resultFile = Join-Path $env:USERPROFILE 'Desktop\BuyFlow-Targeted-Gmail-ExpressOne-result.json'

function Fail([string]$message) {
    Write-Host ''
    Write-Host ('HIBA: ' + $message) -ForegroundColor Red
    Write-Host ''
    Write-Host 'Kuldd el az utolso 10 sort.'
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

if (-not (Test-Path $nodeExe)) { Fail 'A BuyFlow Node runtime hianyzik.' }
if (-not (Test-Path $n8nBin)) { Fail 'Az n8n runtime hianyzik.' }
if (-not (Test-Path $envFile)) { Fail 'A local.env hianyzik.' }
if (-not (Test-Path $targetTemplate)) { Fail 'A targeted workflow template hianyzik.' }
if ($MessageId -notmatch '^[a-fA-F0-9]{10,64}$') { Fail 'Ervenytelen Gmail Message ID.' }

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

$env:PATH = "$nodeHome;$env:PATH"
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
$env:BUYFLOW_OLLAMA_MODEL = 'qwen3:8b'
$env:BUYFLOW_AI_EXECUTE = 'false'

Write-Host ''
Write-Host '============================================================'
Write-Host 'BUYFLOW TARGETED GMAIL V2'
Write-Host 'One exact Gmail message -> Qwen Agent+Critic -> SHADOW audit'
Write-Host '============================================================'
Write-Host ''

Write-Host '[1/6] n8n leallitasa...'
if (Test-Path $pidFile) {
    try {
        $raw = (Get-Content $pidFile -Raw).Trim()
        if ($raw -match '^\d+$') {
            Stop-Process -Id ([int]$raw) -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    } catch {}
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
try {
    $listeners = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        if ($listener.OwningProcess -gt 0) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2
} catch {}

Write-Host '[2/6] Meglevo Gmail OAuth credential kiolvasasa...'
Remove-Item $tempSource,$tempTarget -Force -ErrorAction SilentlyContinue
& $nodeExe $n8nBin export:workflow --id=$sourceId --output=$tempSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempSource)) { Fail 'Nem sikerult exportalni a Gmail SHADOW workflow-t.' }

$exported = Get-Content $tempSource -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceWorkflow = if ($exported -is [System.Array]) { $exported[0] } else { $exported }
$sourceGmailNode = $sourceWorkflow.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.gmailTrigger' } | Select-Object -First 1
if (-not $sourceGmailNode) { Fail 'A forras Gmail Trigger node nem talalhato.' }
if (-not $sourceGmailNode.credentials) { Fail 'A Gmail OAuth credential nincs hozzarendelve.' }

Write-Host '[3/6] Targeted workflow epites...'
$targetWorkflow = Get-Content $targetTemplate -Raw -Encoding UTF8 | ConvertFrom-Json
$targetGmailNode = $targetWorkflow.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.gmail' } | Select-Object -First 1
if (-not $targetGmailNode) { Fail 'A Gmail Get node nem talalhato.' }
$targetGmailNode | Add-Member -NotePropertyName credentials -NotePropertyValue $sourceGmailNode.credentials -Force
$targetWorkflow | ConvertTo-Json -Depth 100 -Compress | Set-Content -Path $tempTarget -Encoding UTF8

Write-Host '[4/6] Import + publish...'
& $nodeExe $n8nBin import:workflow --input=$tempTarget
if ($LASTEXITCODE -ne 0) { Fail 'Targeted workflow import sikertelen.' }
& $nodeExe $n8nBin publish:workflow --id=$targetId
if ($LASTEXITCODE -ne 0) { Fail 'Targeted workflow publish sikertelen.' }

Write-Host '[5/6] n8n inditasa...'
Set-Content -Path $logFile -Value '' -Encoding UTF8
Set-Content -Path $errFile -Value '' -Encoding UTF8
$proc = Start-Process -FilePath $nodeExe -ArgumentList @($n8nBin, 'start') -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
Set-Content -Path $pidFile -Value $proc.Id -Encoding ASCII

$deadline = (Get-Date).AddMinutes(4)
do {
    Start-Sleep -Seconds 3
    if (Test-Http200 'http://127.0.0.1:5678/' 3) { break }
    if ($proc.HasExited) {
        $err = if (Test-Path $errFile) { (Get-Content $errFile -Tail 50 | Out-String) } else { '' }
        Fail ('n8n leallt indulas kozben. ' + $err)
    }
} while ((Get-Date) -lt $deadline)
if (-not (Test-Http200 'http://127.0.0.1:5678/' 3)) { Fail 'n8n web UI nem indult el 4 percen belul.' }

Write-Host '[6/6] Express One targeted teszt...'
$uri = "http://127.0.0.1:5678/webhook/buyflow-gmail-targeted-test-v2?message_id=$MessageId"
try {
    $result = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 240
} catch {
    Fail ('Targeted webhook sikertelen: ' + $_.Exception.Message)
}

$result | ConvertTo-Json -Depth 30 | Set-Content -Path $resultFile -Encoding UTF8

$decision = $result.buyflow_result.decision
$pass = (
    $result.shadow_only -eq $true -and
    $result.write_performed -eq $false -and
    $result.buyflow_result.mode -eq 'SHADOW' -and
    $result.buyflow_result.execution_allowed -eq $false -and
    $decision.event_type -eq 'SHIPMENT_CREATED' -and
    $decision.action -eq 'REVIEW' -and
    $null -eq $decision.selected_purchase_id
)

Write-Host ''
Write-Host '================ TARGETED RESULT ================'
$result | ConvertTo-Json -Depth 30 | Write-Host
Write-Host '=================================================='
Write-Host ''
if ($pass) {
    Write-Host 'PASS - Express One: SHIPMENT_CREATED + REVIEW, SHADOW safe.' -ForegroundColor Green
} else {
    Write-Host 'REVIEW - a futas lement, de a vart dontes nem teljesult.' -ForegroundColor Yellow
}
Write-Host ('Eredmeny fajl: ' + $resultFile)
Write-Host ''
Read-Host 'Nyomj Entert a bezarashoz'
