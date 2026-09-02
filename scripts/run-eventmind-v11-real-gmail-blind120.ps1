param(
    [Parameter(Mandatory = $true)][string]$IdFile,
    [Parameter(Mandatory = $true)][string]$ExpectedIdSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RunnerUrl = 'https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/163542b7f392267d24a75ca91123c9e71bca97fd/apps/api/src/scripts/eventmind-v11-real-gmail-blind120.ts'
$RepoWorkflowId = 'bf-gmail-targeted-test-v2'
$TargetWebhookPath = 'buyflow-gmail-targeted-test-v2'
$distro = 'Ubuntu-24.04'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot = Join-Path $env:TEMP ("buyflow-eventmind-v11-blind120-" + [guid]::NewGuid().ToString('N'))
$workflowPath = Join-Path $tempRoot 'workflow.json'
$credentialPath = Join-Path $tempRoot 'credential.json'
$stdout = Join-Path $tempRoot 'eventmind-v11.out.log'
$stderr = Join-Path $tempRoot 'eventmind-v11.err.log'
$serverProcess = $null
$originalUserFolder = $env:N8N_USER_FOLDER
$project = $null
$localRunner = $null
$reportPath = Join-Path $env:USERPROFILE ("Desktop\BuyFlow-EVENTMIND-V11-REAL-GMAIL-BLIND120-PREDICTIONS-$stamp.json")

function Fail([string]$Message) { throw $Message }
function As-Array($Value) {
    if ($null -eq $Value) { return @() }
    if ($Value -is [System.Array]) { return @($Value) }
    return @($Value)
}
function Get-PropertyValue($Object, [string[]]$Names) {
    if ($null -eq $Object) { return $null }
    foreach ($name in $Names) {
        $prop = $Object.PSObject.Properties[$name]
        if ($null -ne $prop -and $null -ne $prop.Value) {
            if ($prop.Value -isnot [string] -or -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
                return $prop.Value
            }
        }
    }
    return $null
}
function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Fail "Expected file was not created: $Path" }
    $raw = Get-Content -Raw -LiteralPath $Path
    if ([string]::IsNullOrWhiteSpace($raw)) { Fail "JSON file is empty: $Path" }
    return ($raw | ConvertFrom-Json)
}
function Get-Sha256Text([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}
function Convert-ToWslPath([string]$p) {
    $full = [System.IO.Path]::GetFullPath($p)
    if ($full -notmatch '^([A-Za-z]):\\(.*)$') { Fail "WSL_PATH_UNSUPPORTED: $full" }
    $drive = $Matches[1].ToLowerInvariant()
    $rest = $Matches[2].Replace('\','/')
    return "/mnt/$drive/$rest"
}
function Stop-EventMindServer {
    if ($serverProcess) {
        try {
            if (-not $serverProcess.HasExited) {
                Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
            }
        } catch {}
    }
    if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
        & wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v11-runtime.py' || true" | Out-Null
    }
}
function Find-BuyFlowProject {
    $known = @(
        (Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
        (Join-Path $env:USERPROFILE 'Desktop\buyflow\buyflow-v3')
    )
    foreach ($candidate in $known) {
        if ((Test-Path (Join-Path $candidate 'apps\api\package.json')) -and (Test-Path (Join-Path $candidate 'scripts\eventmind-v11-runtime.py'))) {
            return $candidate
        }
    }
    $root = Join-Path $env:USERPROFILE 'Desktop\buyflow'
    if (-not (Test-Path $root)) { return $null }
    $matches = @(Get-ChildItem -LiteralPath $root -Filter 'eventmind-v11-runtime.py' -File -Recurse -ErrorAction SilentlyContinue)
    foreach ($match in $matches) {
        $candidate = Split-Path -Parent (Split-Path -Parent $match.FullName)
        if (Test-Path (Join-Path $candidate 'apps\api\package.json')) { return $candidate }
    }
    return $null
}

$nodePath = 'C:\Program Files\nodejs\node.exe'
$n8nScript = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$n8nDb = Join-Path $n8nUserFolder '.n8n\database.sqlite'

function Invoke-N8n([string[]]$Arguments) {
    $output = & $nodePath $n8nScript @Arguments 2>&1
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        throw ("n8n command failed: {0}`n{1}" -f ($Arguments -join ' '), ($output -join "`n"))
    }
    return @($output)
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    Write-Host ''
    Write-Host '==============================================================' -ForegroundColor Cyan
    Write-Host 'BUYFLOW EVENTMIND V11 - REAL GMAIL BLIND120' -ForegroundColor Cyan
    Write-Host '120 VALODI, ELORE NEM CIMEKEZETT EMAIL - READ ONLY' -ForegroundColor Cyan
    Write-Host '==============================================================' -ForegroundColor Cyan
    Write-Host 'Nem tanitja a modellt, nem ir Gmailbe, nem ir BuyFlow production DB-be.' -ForegroundColor Green
    Write-Host ''

    if (-not (Test-Path -LiteralPath $IdFile -PathType Leaf)) { Fail "ID_FILE_NOT_FOUND: $IdFile" }
    $ids = As-Array (Read-JsonFile $IdFile)
    if ($ids.Count -ne 120) { Fail "EXPECTED_120_IDS_GOT_$($ids.Count)" }
    $canonicalIds = [string]::Join("`n", [string[]]$ids)
    $actualIdSha = Get-Sha256Text $canonicalIds
    if ($actualIdSha -ne $ExpectedIdSha256.ToLowerInvariant()) {
        Fail "FROZEN_ID_SHA_MISMATCH: $actualIdSha"
    }
    Write-Host ("Frozen Gmail ID SHA256: " + $actualIdSha) -ForegroundColor Green

    $project = Find-BuyFlowProject
    if (-not $project) { Fail 'BUYFLOW_PROJECT_NOT_FOUND_UNDER_DESKTOP_BUYFLOW' }
    Write-Host ("BuyFlow project: " + $project)
    $server = Join-Path $project 'scripts\eventmind-v11-runtime.py'
    $localRunner = Join-Path $project ("apps\api\src\scripts\.eventmind-v11-real-gmail-blind120-" + [guid]::NewGuid().ToString('N') + '.ts')

    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { Fail 'WSL_NOT_FOUND' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail 'NPM_NOT_FOUND' }
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { Fail "NODE_NOT_FOUND: $nodePath" }
    if (-not (Test-Path -LiteralPath $n8nScript -PathType Leaf)) { Fail "N8N_RUNTIME_NOT_FOUND: $n8nScript" }
    if (-not (Test-Path -LiteralPath $n8nDb -PathType Leaf)) { Fail "N8N_DATABASE_NOT_FOUND: $n8nDb" }
    if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { Fail "EVENTMIND_SERVER_NOT_FOUND: $server" }

    Write-Host ''
    Write-Host '[1/4] Meglevo n8n Gmail OAuth biztonsagos, ideiglenes hasznalata...' -ForegroundColor Yellow
    $env:N8N_USER_FOLDER = $n8nUserFolder
    $version = (Invoke-N8n @('--version') | Select-Object -First 1)
    Write-Host ("n8n version: " + $version)
    Invoke-N8n @('export:workflow','--all',"--output=$workflowPath") | Out-Null
    $workflows = As-Array (Read-JsonFile $workflowPath)
    $workflow = $null
    foreach ($candidate in $workflows) {
        $candidateId = [string](Get-PropertyValue $candidate @('id'))
        $candidateName = [string](Get-PropertyValue $candidate @('name'))
        $nodes = As-Array (Get-PropertyValue $candidate @('nodes'))
        $hasTargetWebhook = $false
        foreach ($node in $nodes) {
            $parameters = Get-PropertyValue $node @('parameters')
            $path = [string](Get-PropertyValue $parameters @('path'))
            if ($path -eq $TargetWebhookPath) { $hasTargetWebhook = $true; break }
        }
        if ($hasTargetWebhook -or $candidateId -eq $RepoWorkflowId -or $candidateName -match 'gmail.*targeted|targeted.*gmail') {
            $workflow = $candidate
            break
        }
    }
    if ($null -eq $workflow) { Fail 'TARGETED_GMAIL_WORKFLOW_NOT_FOUND' }

    $gmailCredentialId = $null
    $gmailCredentialName = $null
    $workflowNodes = As-Array (Get-PropertyValue $workflow @('nodes'))
    foreach ($node in $workflowNodes) {
        $credentials = Get-PropertyValue $node @('credentials')
        if ($null -eq $credentials) { continue }
        foreach ($prop in $credentials.PSObject.Properties) {
            if ($prop.Name -notmatch 'gmail|google.*oauth|oauth.*google') { continue }
            $cred = $prop.Value
            $candidateCredId = [string](Get-PropertyValue $cred @('id'))
            if (-not [string]::IsNullOrWhiteSpace($candidateCredId)) {
                $gmailCredentialId = $candidateCredId
                $gmailCredentialName = [string](Get-PropertyValue $cred @('name'))
                break
            }
        }
        if ($gmailCredentialId) { break }
    }
    if (-not $gmailCredentialId) { Fail 'GMAIL_CREDENTIAL_REFERENCE_NOT_FOUND' }
    Write-Host ("Gmail credential: " + $(if($gmailCredentialName){$gmailCredentialName}else{'<unnamed>'}))
    Write-Host 'Credential ertekek nem jelennek meg.'

    Invoke-N8n @('export:credentials',"--id=$gmailCredentialId",'--decrypted',"--output=$credentialPath") | Out-Null
    $credential = (As-Array (Read-JsonFile $credentialPath) | Select-Object -First 1)
    $data = Get-PropertyValue $credential @('data')
    if ($null -eq $data) { Fail 'GMAIL_CREDENTIAL_DATA_MISSING' }
    $clientId = [string](Get-PropertyValue $data @('clientId','client_id'))
    $clientSecret = [string](Get-PropertyValue $data @('clientSecret','client_secret'))
    $accessToken = [string](Get-PropertyValue $data @('accessToken','access_token'))
    $refreshToken = [string](Get-PropertyValue $data @('refreshToken','refresh_token'))
    $tokenData = Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if ($null -ne $tokenData) {
        $parsedToken = $null
        if ($tokenData -is [string]) { try { $parsedToken = $tokenData | ConvertFrom-Json } catch {} }
        else { $parsedToken = $tokenData }
        if ($parsedToken) {
            if (-not $accessToken) { $accessToken = [string](Get-PropertyValue $parsedToken @('access_token','accessToken')) }
            if (-not $refreshToken) { $refreshToken = [string](Get-PropertyValue $parsedToken @('refresh_token','refreshToken')) }
        }
    }
    if ($clientId -and $clientSecret -and $refreshToken) {
        $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
            client_id = $clientId
            client_secret = $clientSecret
            refresh_token = $refreshToken
            grant_type = 'refresh_token'
        } -TimeoutSec 30
        $accessToken = [string](Get-PropertyValue $tokenResponse @('access_token'))
    }
    if (-not $accessToken) { Fail 'GMAIL_ACCESS_TOKEN_NOT_AVAILABLE' }

    Write-Host ''
    Write-Host '[2/4] EventMind V11 helyi modell inditasa...' -ForegroundColor Yellow
    $wslProject = Convert-ToWslPath $project
    $wslServer = Convert-ToWslPath $server
    $wslHome = (& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
    if ([string]::IsNullOrWhiteSpace($wslHome)) { Fail 'WSL_HOME_NOT_FOUND' }
    $wslPython = "$wslHome/.venvs/buyflow-lora/bin/python"
    & wsl.exe -d $distro -- test -x $wslPython
    if ($LASTEXITCODE -ne 0) { Fail "LORA_PYTHON_NOT_FOUND: $wslPython" }

    Stop-EventMindServer
    $launchArgs = @(
        '-d', $distro,
        '--',
        'env',
        'HSA_ENABLE_DXG_DETECTION=1',
        'TOKENIZERS_PARALLELISM=false',
        $wslPython,
        $wslServer,
        $wslProject
    )
    $serverProcess = Start-Process -FilePath 'wsl.exe' -ArgumentList $launchArgs -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    if (-not $serverProcess -or $serverProcess.Id -le 0) { Fail 'EVENTMIND_SERVER_START_FAILED' }
    $health = $null
    for ($i = 0; $i -lt 180; $i++) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4394/health' -Method Get -TimeoutSec 2
            if ($health.ok) { break }
        } catch {}
        if ($serverProcess.HasExited) { break }
        Start-Sleep -Seconds 1
    }
    if (-not $health -or -not $health.ok) {
        if (Test-Path $stderr) { Get-Content $stderr -Tail 30 }
        Fail 'EVENTMIND_V11_RUNTIME_START_FAILED'
    }
    if ($health.model_id -ne 'Qwen/Qwen3-8B') { Fail "EVENTMIND_MODEL_MISMATCH: $($health.model_id)" }
    if ($health.thinking_enabled -ne $false) { Fail 'EVENTMIND_THINKING_NOT_DISABLED' }
    if ($health.deterministic -ne $true) { Fail 'EVENTMIND_NOT_DETERMINISTIC' }
    if ([string]$health.adapter_sha256 -notmatch '^[a-fA-F0-9]{64}$') { Fail 'EVENTMIND_ADAPTER_SHA_INVALID' }
    Write-Host ("V11 adapter SHA: " + [string]$health.adapter_sha256) -ForegroundColor Green

    Write-Host ''
    Write-Host '[3/4] 120 valodi Gmail level -> MailLens -> EventMind V11...' -ForegroundColor Yellow
    Invoke-WebRequest -UseBasicParsing -Uri $RunnerUrl -OutFile $localRunner -TimeoutSec 30
    $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN = $accessToken
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED = 'true'
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL = 'http://127.0.0.1:4394/v1/eventmind'
    $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 = [string]$health.adapter_sha256
    $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS = '30000'

    Push-Location (Join-Path $project 'apps\api')
    try {
        & npm.cmd exec -- tsx $localRunner $IdFile $reportPath
        $testExit = $LASTEXITCODE
    } finally { Pop-Location }

    Write-Host ''
    Write-Host '[4/4] Prediction freeze kesz.' -ForegroundColor Yellow
    if ($testExit -eq 0) {
        Write-Host 'BLIND120 PREDICTION FREEZE: COMPLETE' -ForegroundColor Green
        Write-Host 'Most mar lehet a 120 level ground truth-jat megnezni es pontozni.' -ForegroundColor Green
    } elseif ($testExit -eq 2) {
        Write-Host 'BLIND120 PREDICTION FREEZE: INCOMPLETE - egy vagy tobb technikai hiba volt.' -ForegroundColor Yellow
        exit 2
    } else {
        Fail "BLIND120_RUNNER_ERROR: $testExit"
    }
} catch {
    Write-Host ''
    Write-Host ('BLIND120 BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
    if (Test-Path $stderr) {
        Write-Host 'V11 server utolso hibasorai:' -ForegroundColor DarkYellow
        Get-Content $stderr -Tail 20
    }
    exit 1
} finally {
    Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 -ErrorAction SilentlyContinue
    Remove-Item Env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS -ErrorAction SilentlyContinue
    Stop-EventMindServer
    if ($localRunner -and (Test-Path -LiteralPath $localRunner)) { Remove-Item -LiteralPath $localRunner -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $credentialPath) {
        try { Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue } catch {}
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if ($null -eq $originalUserFolder) { Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue }
    else { $env:N8N_USER_FOLDER = $originalUserFolder }
}
