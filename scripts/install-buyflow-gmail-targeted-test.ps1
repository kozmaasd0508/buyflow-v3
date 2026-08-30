param(
    [string]$MessageId = ''
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$runtimeRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime'
$nodeHome = Join-Path $dataRoot 'node-v24.20.0-win-x64'
$nodeExe = Join-Path $nodeHome 'node.exe'
$n8nBin = Join-Path $runtimeRoot 'node_modules\n8n\bin\n8n'
$sourceId = 'bf-gmail-shadow-intake-v1'
$targetId = 'bf-gmail-targeted-test-v1'
$targetTemplate = Join-Path $root 'infra\n8n-local\workflows\buyflow-gmail-targeted-test.json'
$stopScript = Join-Path $root 'scripts\stop-buyflow-n8n-local.ps1'
$startScript = Join-Path $root 'scripts\start-buyflow-n8n-local.ps1'
$tempSource = Join-Path $env:TEMP 'buyflow-gmail-source-export.json'
$tempTarget = Join-Path $env:TEMP 'buyflow-gmail-targeted-import.json'

function Fail([string]$message) {
    Write-Host ''
    Write-Host "HIBA: $message" -ForegroundColor Red
    Write-Host ''
    Read-Host 'Nyomj Entert a bezarashoz'
    exit 1
}

Write-Host ''
Write-Host '============================================================'
Write-Host 'BUYFLOW - TARGETED GMAIL SHADOW TEST'
Write-Host 'Pontosan egy Gmail Message ID -> Qwen Agent+Critic'
Write-Host '============================================================'
Write-Host ''

if (-not (Test-Path $nodeExe)) { Fail 'A BuyFlow sajat Node.js runtime hianyzik. Inditsd el egyszer a normal BuyFlow n8n inditot.' }
if (-not (Test-Path $n8nBin)) { Fail 'Az n8n runtime hianyzik. Inditsd el egyszer a normal BuyFlow n8n inditot.' }
if (-not (Test-Path $targetTemplate)) { Fail 'A targeted Gmail workflow fajl hianyzik.' }

Write-Host 'n8n leallitasa az importhoz...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript | Out-Host
Start-Sleep -Seconds 1

$env:N8N_USER_FOLDER = $dataRoot
$env:DB_TYPE = 'sqlite'
$env:DB_SQLITE_POOL_SIZE = '2'
$env:N8N_SECURE_COOKIE = 'false'

Remove-Item $tempSource,$tempTarget -Force -ErrorAction SilentlyContinue

Write-Host 'Meglevo Gmail OAuth kapcsolat kiolvasasa...'
& $nodeExe $n8nBin export:workflow --id=$sourceId --output=$tempSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempSource)) { Fail 'Nem sikerult exportalni a mar beallitott Gmail workflow-t.' }

$exported = Get-Content $tempSource -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceWorkflow = if ($exported -is [System.Array]) { $exported[0] } else { $exported }
$sourceGmailNode = $sourceWorkflow.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.gmailTrigger' } | Select-Object -First 1
if (-not $sourceGmailNode) { Fail 'A forras Gmail Trigger node nem talalhato.' }
if (-not $sourceGmailNode.credentials) { Fail 'A Gmail OAuth credential nincs hozzarendelve a jelenlegi Gmail Triggerhez.' }

Write-Host 'Targeted workflow osszeallitasa ugyanazzal a Gmail OAuth credentiallel...'
$targetWorkflow = Get-Content $targetTemplate -Raw -Encoding UTF8 | ConvertFrom-Json
$targetGmailNode = $targetWorkflow.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.gmail' } | Select-Object -First 1
if (-not $targetGmailNode) { Fail 'A targeted Gmail Get node nem talalhato.' }
$targetGmailNode | Add-Member -NotePropertyName credentials -NotePropertyValue $sourceGmailNode.credentials -Force
$targetWorkflow | ConvertTo-Json -Depth 100 | Set-Content -Path $tempTarget -Encoding UTF8

Write-Host 'Targeted Gmail workflow importalasa...'
& $nodeExe $n8nBin import:workflow --input=$tempTarget
if ($LASTEXITCODE -ne 0) { Fail 'A targeted Gmail workflow importja sikertelen.' }

Write-Host 'Targeted Gmail workflow publikalasa...'
& $nodeExe $n8nBin publish:workflow --id=$targetId
if ($LASTEXITCODE -ne 0) { Fail 'A targeted Gmail workflow publikalasa sikertelen.' }

Write-Host 'n8n + Ollama ujrainditasa...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript | Out-Host

if ($MessageId) {
    if ($MessageId -notmatch '^[a-fA-F0-9]{10,64}$') { Fail 'Ervenytelen Gmail Message ID.' }
    Write-Host ''
    Write-Host "Celzott teszt indul: $MessageId"
    $uri = "http://127.0.0.1:5678/webhook/buyflow-gmail-targeted-test?message_id=$MessageId"
    try {
        $result = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 240
        Write-Host ''
        Write-Host '================ TARGETED RESULT ================' -ForegroundColor Green
        $result | ConvertTo-Json -Depth 30 | Write-Host
        Write-Host '==================================================' -ForegroundColor Green
    } catch {
        Fail "A targeted webhook teszt sikertelen: $($_.Exception.Message)"
    }
} else {
    Write-Host ''
    Write-Host 'KESZ. A celzott Gmail endpoint aktiv:' -ForegroundColor Green
    Write-Host 'http://127.0.0.1:5678/webhook/buyflow-gmail-targeted-test?message_id=GMAIL_ID'
}

Remove-Item $tempSource,$tempTarget -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host 'SHADOW ONLY: nincs Gmail vagy BuyFlow iras.' -ForegroundColor Yellow
Read-Host 'Nyomj Entert a bezarashoz'
