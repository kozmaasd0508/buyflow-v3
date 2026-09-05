$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoWorkflowId = 'bf-gmail-targeted-test-v2'
$TargetWebhookPath = 'buyflow-gmail-targeted-test-v2'
$SampleLimit = 6
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $env:USERPROFILE ("Desktop\BuyFlow-MAILGATE-HISTORY-SMOKE-$stamp.json")
$tempRoot = Join-Path $env:TEMP ("buyflow-mailgate-history-" + [guid]::NewGuid().ToString('N'))
$workflowPath = Join-Path $tempRoot 'workflow.json'
$credentialPath = Join-Path $tempRoot 'credential.json'

function Fail([string]$Message) {
    throw $Message
}

function Invoke-N8nCli([string[]]$Arguments) {
    $output = & n8n @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("n8n command failed: n8n {0}`n{1}" -f ($Arguments -join ' '), ($output -join "`n"))
    }
    return $output
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path $Path)) { Fail "Expected file was not created: $Path" }
    $raw = Get-Content -Raw -LiteralPath $Path
    if ([string]::IsNullOrWhiteSpace($raw)) { Fail "JSON file is empty: $Path" }
    return ($raw | ConvertFrom-Json)
}

function As-Array($Value) {
    if ($null -eq $Value) { return @() }
    if ($Value -is [System.Array]) { return @($Value) }
    return @($Value)
}

function Get-PropertyValue($Object, [string[]]$Names) {
    if ($null -eq $Object) { return $null }
    foreach ($name in $Names) {
        $prop = $Object.PSObject.Properties[$name]
        if ($null -ne $prop -and $null -ne $prop.Value -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
            return $prop.Value
        }
    }
    return $null
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

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host 'BUYFLOW MAILGATE - REAL GMAIL historyId/history.list SMOKE'
    Write-Host 'READ ONLY - NO MAILBOX MUTATION - NO BUYFLOW DB WRITE'
    Write-Host '============================================================'
    Write-Host ''

    if (-not (Get-Command n8n -ErrorAction SilentlyContinue)) {
        Fail 'n8n command not found. Start from the Windows account where native n8n is installed.'
    }

    $version = (& n8n --version 2>&1 | Select-Object -First 1)
    Write-Host ("n8n: " + $version)

    # Export only workflow metadata first; this contains credential references, not decrypted secrets.
    $specificWorked = $true
    try {
        Invoke-N8nCli @('export:workflow', "--id=$RepoWorkflowId", "--output=$workflowPath") | Out-Null
    } catch {
        $specificWorked = $false
    }

    if (-not $specificWorked) {
        Invoke-N8nCli @('export:workflow', '--all', "--output=$workflowPath") | Out-Null
    }

    $wfExport = Read-JsonFile $workflowPath
    $workflows = As-Array $wfExport

    $workflow = $null
    foreach ($candidate in $workflows) {
        $nodes = As-Array $candidate.nodes
        $hasTargetWebhook = $false
        foreach ($node in $nodes) {
            $path = Get-PropertyValue $node.parameters @('path')
            if ([string]$path -eq $TargetWebhookPath) { $hasTargetWebhook = $true; break }
        }
        if ($hasTargetWebhook -or [string]$candidate.id -eq $RepoWorkflowId -or [string]$candidate.name -match 'gmail.*targeted|targeted.*gmail') {
            $workflow = $candidate
            break
        }
    }
    if ($null -eq $workflow -and $workflows.Count -eq 1) { $workflow = $workflows[0] }
    if ($null -eq $workflow) { Fail 'Could not locate the existing targeted Gmail n8n workflow.' }

    $gmailCredentialId = $null
    $gmailCredentialName = $null
    $gmailCredentialType = $null
    foreach ($node in (As-Array $workflow.nodes)) {
        if ($null -eq $node.credentials) { continue }
        foreach ($prop in $node.credentials.PSObject.Properties) {
            if ($prop.Name -notmatch 'gmail|google.*oauth|oauth.*google') { continue }
            $cred = $prop.Value
            $candidateId = Get-PropertyValue $cred @('id')
            if ($candidateId) {
                $gmailCredentialType = $prop.Name
                $gmailCredentialId = [string]$candidateId
                $gmailCredentialName = [string](Get-PropertyValue $cred @('name'))
                break
            }
        }
        if ($gmailCredentialId) { break }
    }
    if (-not $gmailCredentialId) { Fail 'Could not find the Gmail OAuth credential reference in the targeted workflow.' }

    Write-Host ("Gmail credential found: " + $(if ($gmailCredentialName) { $gmailCredentialName } else { '<unnamed>' }))
    Write-Host 'Credential values will NOT be printed.'

    # Decrypt only this one already-authorized local credential, into a random TEMP folder.
    # The file is removed in finally even if the smoke fails.
    Invoke-N8nCli @('export:credentials', "--id=$gmailCredentialId", '--decrypted', "--output=$credentialPath") | Out-Null
    $credExport = Read-JsonFile $credentialPath
    $credential = (As-Array $credExport | Select-Object -First 1)
    if ($null -eq $credential) { Fail 'Credential export returned no credential.' }
    $data = $credential.data
    if ($null -eq $data) { Fail 'Decrypted Gmail credential has no data object.' }

    $clientId = [string](Get-PropertyValue $data @('clientId','client_id'))
    $clientSecret = [string](Get-PropertyValue $data @('clientSecret','client_secret'))
    $accessToken = [string](Get-PropertyValue $data @('accessToken','access_token'))
    $refreshToken = [string](Get-PropertyValue $data @('refreshToken','refresh_token'))

    $tokenData = Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if ($tokenData) {
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
        $accessToken = [string]$tokenResponse.access_token
    }

    if (-not $accessToken) {
        $fieldNames = @($data.PSObject.Properties.Name) -join ', '
        Fail ("Could not obtain an access token from the existing Gmail credential. Available credential fields: $fieldNames")
    }

    $headers = @{ Authorization = "Bearer $accessToken" }
    $gmailBase = 'https://gmail.googleapis.com/gmail/v1/users/me'

    # Capture Gmail's current history boundary with a GET-only call.
    $profileBefore = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30
    $startHistoryId = [string]$profileBefore.historyId
    if ($startHistoryId -notmatch '^\d+$') { Fail 'Gmail profile did not return a numeric historyId.' }

    # Bounded read-only sample and exact RAW MIME availability check.
    $query = [uri]::EscapeDataString('newer_than:30d -in:spam -in:trash')
    $list = Invoke-RestMethod -Method Get -Uri "$gmailBase/messages?q=$query&maxResults=$SampleLimit" -Headers $headers -TimeoutSec 30
    $messageRefs = As-Array $list.messages
    $rawParity = 0
    $totalRawBytes = 0L
    foreach ($messageRef in ($messageRefs | Select-Object -First $SampleLimit)) {
        $id = [uri]::EscapeDataString([string]$messageRef.id)
        $rawMessage = Invoke-RestMethod -Method Get -Uri "$gmailBase/messages/$id?format=raw" -Headers $headers -TimeoutSec 30
        if (-not $rawMessage.raw) { Fail 'Gmail message GET format=raw returned no RAW MIME payload.' }
        $bytes = ConvertFrom-Base64Url ([string]$rawMessage.raw)
        if ($bytes.Length -lt 1) { Fail 'Gmail returned empty RAW MIME bytes.' }
        # Hash locally to prove exact bytes are available. Digest is intentionally never printed.
        $sha = [Security.Cryptography.SHA256]::Create()
        try { [void]$sha.ComputeHash($bytes) } finally { $sha.Dispose() }
        $rawParity++
        $totalRawBytes += $bytes.Length
    }

    # Exercise the actual Gmail users.history.list endpoint from the captured boundary.
    # No checkpoint is stored and no mailbox mutation is performed.
    $historyUri = "$gmailBase/history?startHistoryId=$startHistoryId&maxResults=100"
    $history = Invoke-RestMethod -Method Get -Uri $historyUri -Headers $headers -TimeoutSec 30
    $historyRecords = As-Array $history.history
    $nextHistoryId = [string]$history.historyId
    if ($nextHistoryId -notmatch '^\d+$') { Fail 'Gmail history.list did not return a valid historyId.' }

    $profileAfter = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30

    $report = [ordered]@{
        suite = 'MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V1'
        created_at = (Get-Date).ToString('o')
        n8n_version = [string]$version
        credential_source = 'existing_local_n8n_gmail_oauth'
        credential_type = $gmailCredentialType
        mode = 'read_only_no_commit'
        sampled_messages = $messageRefs.Count
        raw_mime_checked = $rawParity
        raw_mime_parity = ($rawParity -eq [Math]::Min($SampleLimit, $messageRefs.Count))
        total_raw_bytes_observed = $totalRawBytes
        initial_history_id_captured = ($startHistoryId -match '^\d+$')
        history_list_called = $true
        history_replay_succeeded = ($nextHistoryId -match '^\d+$')
        observed_history_records = $historyRecords.Count
        next_history_id_valid = ($nextHistoryId -match '^\d+$')
        profile_after_history_id_valid = ([string]$profileAfter.historyId -match '^\d+$')
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

    $json = $report | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($reportPath, $json, (New-Object Text.UTF8Encoding($false)))

    Write-Host ''
    Write-Host '==================== SUMMARY ==================='
    Write-Host ("RAW MIME:        {0}/{1}" -f $rawParity, [Math]::Min($SampleLimit, $messageRefs.Count))
    Write-Host ("historyId:       {0}" -f $(if ($report.initial_history_id_captured) { 'PASS' } else { 'FAIL' }))
    Write-Host ("history.list:     {0}" -f $(if ($report.history_replay_succeeded) { 'PASS' } else { 'FAIL' }))
    Write-Host ("History records: {0}" -f $historyRecords.Count)
    Write-Host 'Mailbox writes:  0'
    Write-Host 'BuyFlow DB writes: 0'
    Write-Host 'AI calls:        0'
    Write-Host ('Report:          ' + $reportPath)
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
    # Best-effort cleanup of the only decrypted credential copy created by this smoke.
    if (Test-Path $credentialPath) {
        try { Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue } catch { }
    }
    if (Test-Path $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
