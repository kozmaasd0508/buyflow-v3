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

function Fail([string]$Message) { throw $Message }

function Resolve-N8nCommand {
    $resolved = Get-Command n8n.cmd -ErrorAction SilentlyContinue
    if (-not $resolved) { $resolved = Get-Command n8n -ErrorAction SilentlyContinue }
    if ($resolved) { return $resolved.Source }

    $candidates = @()
    if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'npm\n8n.cmd') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'npm\n8n.cmd') }
    if ($env:USERPROFILE) {
        $candidates += (Join-Path $env:USERPROFILE 'AppData\Roaming\npm\n8n.cmd')
        $candidates += (Join-Path $env:USERPROFILE 'AppData\Local\npm\n8n.cmd')
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
    if ($npm) {
        try {
            $prefix = (& $npm.Source prefix -g 2>$null | Select-Object -First 1).Trim()
            if ($prefix) {
                $candidates += (Join-Path $prefix 'n8n.cmd')
                $candidates += (Join-Path $prefix 'bin\n8n.cmd')
            }
        } catch { }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    # Last resort: inspect an already-running native n8n/node process and derive its npm shim.
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match '(?i)\\n8n\\|n8n(?:\.cmd)?' }
        foreach ($proc in $procs) {
            if ($proc.CommandLine -match '(?i)([A-Z]:\\[^\"\s]*AppData\\Roaming\\npm)') {
                $candidate = Join-Path $Matches[1] 'n8n.cmd'
                if (Test-Path -LiteralPath $candidate) { return $candidate }
            }
        }
    } catch { }

    return $null
}

$script:N8nCommand = $null
function Invoke-N8nCli([string[]]$Arguments) {
    if (-not $script:N8nCommand) { Fail 'Internal error: n8n command was not resolved.' }
    $output = & $script:N8nCommand @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("n8n command failed: {0} {1}`n{2}" -f $script:N8nCommand, ($Arguments -join ' '), ($output -join "`n"))
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
        if ($null -ne $prop -and $null -ne $prop.Value -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) { return $prop.Value }
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
    Write-Host 'BUYFLOW MAILGATE - REAL GMAIL historyId/history.list SMOKE V2'
    Write-Host 'READ ONLY - NO MAILBOX MUTATION - NO BUYFLOW DB WRITE'
    Write-Host '============================================================'
    Write-Host ''

    $script:N8nCommand = Resolve-N8nCommand
    if (-not $script:N8nCommand) {
        Fail 'n8n telepites nem talalhato a PATH-ban vagy a szokasos Windows npm mappakban.'
    }

    $version = (& $script:N8nCommand --version 2>&1 | Select-Object -First 1)
    Write-Host ("n8n found: " + $script:N8nCommand)
    Write-Host ("n8n version: " + $version)

    $specificWorked = $true
    try { Invoke-N8nCli @('export:workflow', "--id=$RepoWorkflowId", "--output=$workflowPath") | Out-Null } catch { $specificWorked = $false }
    if (-not $specificWorked) { Invoke-N8nCli @('export:workflow', '--all', "--output=$workflowPath") | Out-Null }

    $workflows = As-Array (Read-JsonFile $workflowPath)
    $workflow = $null
    foreach ($candidate in $workflows) {
        $hasTargetWebhook = $false
        foreach ($node in (As-Array $candidate.nodes)) {
            $path = Get-PropertyValue $node.parameters @('path')
            if ([string]$path -eq $TargetWebhookPath) { $hasTargetWebhook = $true; break }
        }
        if ($hasTargetWebhook -or [string]$candidate.id -eq $RepoWorkflowId -or [string]$candidate.name -match 'gmail.*targeted|targeted.*gmail') { $workflow = $candidate; break }
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

    Invoke-N8nCli @('export:credentials', "--id=$gmailCredentialId", '--decrypted', "--output=$credentialPath") | Out-Null
    $credential = (As-Array (Read-JsonFile $credentialPath) | Select-Object -First 1)
    if ($null -eq $credential -or $null -eq $credential.data) { Fail 'Decrypted Gmail credential has no data object.' }
    $data = $credential.data

    $clientId = [string](Get-PropertyValue $data @('clientId','client_id'))
    $clientSecret = [string](Get-PropertyValue $data @('clientSecret','client_secret'))
    $accessToken = [string](Get-PropertyValue $data @('accessToken','access_token'))
    $refreshToken = [string](Get-PropertyValue $data @('refreshToken','refresh_token'))

    $tokenData = Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if ($tokenData) {
        $parsedToken = $null
        if ($tokenData -is [string]) { try { $parsedToken = $tokenData | ConvertFrom-Json } catch { } } else { $parsedToken = $tokenData }
        if ($parsedToken) {
            if (-not $accessToken) { $accessToken = [string](Get-PropertyValue $parsedToken @('access_token','accessToken')) }
            if (-not $refreshToken) { $refreshToken = [string](Get-PropertyValue $parsedToken @('refresh_token','refreshToken')) }
        }
    }

    if ($clientId -and $clientSecret -and $refreshToken) {
        $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
            client_id = $clientId; client_secret = $clientSecret; refresh_token = $refreshToken; grant_type = 'refresh_token'
        } -TimeoutSec 30
        $accessToken = [string]$tokenResponse.access_token
    }
    if (-not $accessToken) {
        $fieldNames = @($data.PSObject.Properties.Name) -join ', '
        Fail ("Could not obtain an access token from the existing Gmail credential. Available credential fields: $fieldNames")
    }

    $headers = @{ Authorization = "Bearer $accessToken" }
    $gmailBase = 'https://gmail.googleapis.com/gmail/v1/users/me'

    $profileBefore = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30
    $startHistoryId = [string]$profileBefore.historyId
    if ($startHistoryId -notmatch '^\d+$') { Fail 'Gmail profile did not return a numeric historyId.' }

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
        $sha = [Security.Cryptography.SHA256]::Create()
        try { [void]$sha.ComputeHash($bytes) } finally { $sha.Dispose() }
        $rawParity++; $totalRawBytes += $bytes.Length
    }

    $history = Invoke-RestMethod -Method Get -Uri "$gmailBase/history?startHistoryId=$startHistoryId&maxResults=100" -Headers $headers -TimeoutSec 30
    $historyRecords = As-Array $history.history
    $nextHistoryId = [string]$history.historyId
    if ($nextHistoryId -notmatch '^\d+$') { Fail 'Gmail history.list did not return a valid historyId.' }
    $profileAfter = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30

    $report = [ordered]@{
        suite='MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V2'; created_at=(Get-Date).ToString('o'); n8n_version=[string]$version;
        n8n_command=$script:N8nCommand; credential_source='existing_local_n8n_gmail_oauth'; credential_type=$gmailCredentialType;
        mode='read_only_no_commit'; sampled_messages=$messageRefs.Count; raw_mime_checked=$rawParity;
        raw_mime_parity=($rawParity -eq [Math]::Min($SampleLimit,$messageRefs.Count)); total_raw_bytes_observed=$totalRawBytes;
        initial_history_id_captured=($startHistoryId -match '^\d+$'); history_list_called=$true;
        history_replay_succeeded=($nextHistoryId -match '^\d+$'); observed_history_records=$historyRecords.Count;
        next_history_id_valid=($nextHistoryId -match '^\d+$'); profile_after_history_id_valid=([string]$profileAfter.historyId -match '^\d+$');
        safety=[ordered]@{ gmail_http_methods=@('GET'); mailbox_mutations=0; durable_cursor_committed=$false; source_emails_persisted=0; source_archive_writes=0; purchase_writes=0; shipment_writes=0; document_writes=0; ai_calls=0; credential_persisted_by_smoke=$false }
    }
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))

    Write-Host ''
    Write-Host '==================== SUMMARY ==================='
    Write-Host ("RAW MIME:          {0}/{1}" -f $rawParity,[Math]::Min($SampleLimit,$messageRefs.Count))
    Write-Host 'historyId:         PASS'
    Write-Host 'history.list:       PASS'
    Write-Host ("History records:   {0}" -f $historyRecords.Count)
    Write-Host 'Mailbox writes:    0'
    Write-Host 'BuyFlow DB writes: 0'
    Write-Host 'AI calls:          0'
    Write-Host ('Report:            ' + $reportPath)
    Write-Host 'GATE: PASS' -ForegroundColor Green
    Write-Host '================================================'
} catch {
    Write-Host ''
    Write-Host ('MAILGATE HISTORY SMOKE: BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Nothing was written to BuyFlow production by this runner.' -ForegroundColor Yellow
    exit 1
} finally {
    if (Test-Path $credentialPath) { try { Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue } catch { } }
    if (Test-Path $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
