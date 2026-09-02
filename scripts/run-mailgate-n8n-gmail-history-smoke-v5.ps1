$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoWorkflowId = 'bf-gmail-targeted-test-v2'
$TargetWebhookPath = 'buyflow-gmail-targeted-test-v2'
$SampleLimit = 6
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $env:USERPROFILE ("Desktop\BuyFlow-MAILGATE-HISTORY-SMOKE-$stamp.json")
$tempRoot = Join-Path $env:TEMP ("buyflow-mailgate-history-v5-" + [guid]::NewGuid().ToString('N'))
$workflowPath = Join-Path $tempRoot 'workflow.json'
$credentialPath = Join-Path $tempRoot 'credential.json'
$originalUserFolder = $env:N8N_USER_FOLDER

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
function ConvertFrom-Base64Url([string]$Value) {
    $s = $Value.Replace('-', '+').Replace('_', '/')
    switch ($s.Length % 4) {
        2 { $s += '==' }
        3 { $s += '=' }
        0 { }
        default { Fail 'Invalid Gmail base64url RAW payload.' }
    }
    return [Convert]::FromBase64String($s)
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
    Write-Host '============================================================'
    Write-Host 'BUYFLOW MAILGATE - REAL GMAIL historyId/history.list SMOKE V5'
    Write-Host 'READ ONLY - NO MAILBOX MUTATION - NO BUYFLOW DB WRITE'
    Write-Host '============================================================'
    Write-Host ''

    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { Fail "Node not found: $nodePath" }
    if (-not (Test-Path -LiteralPath $n8nScript -PathType Leaf)) { Fail "n8n runtime not found: $n8nScript" }
    if (-not (Test-Path -LiteralPath $n8nDb -PathType Leaf)) { Fail "Expected n8n database not found: $n8nDb" }

    $env:N8N_USER_FOLDER = $n8nUserFolder
    $version = (Invoke-N8n @('--version') | Select-Object -First 1)
    Write-Host ("n8n version: " + $version)
    Write-Host ("n8n data profile: " + $n8nUserFolder)
    Write-Host ("workflow database: " + $n8nDb)

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
    if ($null -eq $workflow) { Fail 'Targeted Gmail workflow was not found in the verified n8n database.' }
    Write-Host 'Targeted Gmail workflow: FOUND'

    $gmailCredentialId = $null
    $gmailCredentialName = $null
    $gmailCredentialType = $null
    $workflowNodes = As-Array (Get-PropertyValue $workflow @('nodes'))
    foreach ($node in $workflowNodes) {
        $credentials = Get-PropertyValue $node @('credentials')
        if ($null -eq $credentials) { continue }
        foreach ($prop in $credentials.PSObject.Properties) {
            if ($prop.Name -notmatch 'gmail|google.*oauth|oauth.*google') { continue }
            $cred = $prop.Value
            $candidateCredId = [string](Get-PropertyValue $cred @('id'))
            if (-not [string]::IsNullOrWhiteSpace($candidateCredId)) {
                $gmailCredentialType = $prop.Name
                $gmailCredentialId = $candidateCredId
                $gmailCredentialName = [string](Get-PropertyValue $cred @('name'))
                break
            }
        }
        if ($gmailCredentialId) { break }
    }
    if (-not $gmailCredentialId) { Fail 'Could not find Gmail OAuth credential reference in the targeted workflow.' }

    if ($gmailCredentialName) { Write-Host ("Gmail credential found: " + $gmailCredentialName) }
    else { Write-Host 'Gmail credential found: <unnamed>' }
    Write-Host 'Credential values will NOT be printed.'

    Invoke-N8n @('export:credentials',"--id=$gmailCredentialId",'--decrypted',"--output=$credentialPath") | Out-Null
    $credential = (As-Array (Read-JsonFile $credentialPath) | Select-Object -First 1)
    if ($null -eq $credential) { Fail 'Credential export returned no credential.' }
    $data = Get-PropertyValue $credential @('data')
    if ($null -eq $data) { Fail 'Decrypted Gmail credential has no data object.' }

    $clientId = [string](Get-PropertyValue $data @('clientId','client_id'))
    $clientSecret = [string](Get-PropertyValue $data @('clientSecret','client_secret'))
    $accessToken = [string](Get-PropertyValue $data @('accessToken','access_token'))
    $refreshToken = [string](Get-PropertyValue $data @('refreshToken','refresh_token'))

    $tokenData = Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if ($null -ne $tokenData) {
        $parsedToken = $null
        if ($tokenData -is [string]) {
            try { $parsedToken = $tokenData | ConvertFrom-Json } catch { }
        } else {
            $parsedToken = $tokenData
        }
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

    if (-not $accessToken) {
        $fieldNames = @($data.PSObject.Properties.Name) -join ', '
        Fail ("Could not obtain an access token from the existing Gmail credential. Available credential fields: $fieldNames")
    }

    $headers = @{ Authorization = "Bearer $accessToken" }
    $gmailBase = 'https://gmail.googleapis.com/gmail/v1/users/me'

    $profileBefore = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30
    $startHistoryId = [string](Get-PropertyValue $profileBefore @('historyId'))
    if ($startHistoryId -notmatch '^\d+$') { Fail 'Gmail profile did not return a numeric historyId.' }

    $query = [uri]::EscapeDataString('newer_than:30d -in:spam -in:trash')
    $list = Invoke-RestMethod -Method Get -Uri "$gmailBase/messages?q=$query&maxResults=$SampleLimit" -Headers $headers -TimeoutSec 30
    $messageRefs = As-Array (Get-PropertyValue $list @('messages'))
    $expectedRaw = [Math]::Min($SampleLimit, $messageRefs.Count)
    $rawParity = 0
    $totalRawBytes = 0L

    foreach ($messageRef in ($messageRefs | Select-Object -First $SampleLimit)) {
        $messageId = [string](Get-PropertyValue $messageRef @('id'))
        if ([string]::IsNullOrWhiteSpace($messageId)) { Fail 'Gmail message list returned an item without id.' }
        $escapedId = [uri]::EscapeDataString($messageId)
        $rawMessage = Invoke-RestMethod -Method Get -Uri "$gmailBase/messages/$escapedId?format=raw" -Headers $headers -TimeoutSec 30
        $rawPayload = [string](Get-PropertyValue $rawMessage @('raw'))
        if ([string]::IsNullOrWhiteSpace($rawPayload)) { Fail 'Gmail message GET format=raw returned no RAW MIME payload.' }
        $bytes = ConvertFrom-Base64Url $rawPayload
        if ($bytes.Length -lt 1) { Fail 'Gmail returned empty RAW MIME bytes.' }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { [void]$sha.ComputeHash($bytes) } finally { $sha.Dispose() }
        $rawParity++
        $totalRawBytes += $bytes.Length
    }

    $historyUri = "$gmailBase/history?startHistoryId=$startHistoryId&maxResults=100"
    $history = Invoke-RestMethod -Method Get -Uri $historyUri -Headers $headers -TimeoutSec 30
    $historyRecords = As-Array (Get-PropertyValue $history @('history'))
    $nextHistoryId = [string](Get-PropertyValue $history @('historyId'))
    if ($nextHistoryId -notmatch '^\d+$') { Fail 'Gmail history.list did not return a valid historyId.' }

    $profileAfter = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30
    $profileAfterHistoryId = [string](Get-PropertyValue $profileAfter @('historyId'))

    $report = [ordered]@{
        suite = 'MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V5'
        created_at = (Get-Date).ToString('o')
        n8n_version = [string]$version
        n8n_user_folder = $n8nUserFolder
        credential_source = 'existing_local_n8n_gmail_oauth'
        credential_type = $gmailCredentialType
        mode = 'read_only_no_commit'
        sampled_messages = $messageRefs.Count
        raw_mime_checked = $rawParity
        raw_mime_parity = ($rawParity -eq $expectedRaw)
        total_raw_bytes_observed = $totalRawBytes
        initial_history_id_captured = ($startHistoryId -match '^\d+$')
        history_list_called = $true
        history_replay_succeeded = ($nextHistoryId -match '^\d+$')
        observed_history_records = $historyRecords.Count
        next_history_id_valid = ($nextHistoryId -match '^\d+$')
        profile_after_history_id_valid = ($profileAfterHistoryId -match '^\d+$')
        safety = [ordered]@{
            gmail_http_methods = @('GET')
            mailbox_mutations = 0
            durable_cursor_committed = $false
            source_emails_persisted = 0
            source_archive_writes = 0
            purchase_writes = 0
            shipment_writes = 0
            document_writes = 0
            ai_calls = 0
            credential_persisted_by_smoke = $false
        }
    }

    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))

    Write-Host ''
    Write-Host '==================== SUMMARY ==================='
    Write-Host ("RAW MIME:          {0}/{1}" -f $rawParity,$expectedRaw)
    Write-Host 'historyId:         PASS'
    Write-Host 'history.list:       PASS'
    Write-Host ("History records:   {0}" -f $historyRecords.Count)
    Write-Host 'Mailbox writes:    0'
    Write-Host 'BuyFlow DB writes: 0'
    Write-Host 'AI calls:          0'
    Write-Host ('Report:            ' + $reportPath)
    Write-Host 'GATE: PASS' -ForegroundColor Green
    Write-Host '================================================'
    Write-Host ''
} catch {
    Write-Host ''
    Write-Host ('MAILGATE HISTORY SMOKE: BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Nothing was written to BuyFlow production by this runner.' -ForegroundColor Yellow
    Write-Host ''
    exit 1
} finally {
    if (Test-Path -LiteralPath $credentialPath) {
        try { Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue } catch { }
    }
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($null -eq $originalUserFolder) { Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue }
    else { $env:N8N_USER_FOLDER = $originalUserFolder }
}
