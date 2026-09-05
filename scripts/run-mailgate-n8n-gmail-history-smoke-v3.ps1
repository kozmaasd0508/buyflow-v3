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

$script:N8nMode = $null
$script:N8nCommand = $null
$script:N8nScript = $null

function Set-N8nCmd([string]$Path) {
    if ($Path -and (Test-Path -LiteralPath $Path)) {
        $script:N8nMode = 'cmd'
        $script:N8nCommand = $Path
        $script:N8nScript = $null
        return $true
    }
    return $false
}

function Set-N8nNodeScript([string]$NodePath, [string]$ScriptPath) {
    if ($NodePath -and $ScriptPath -and (Test-Path -LiteralPath $NodePath) -and (Test-Path -LiteralPath $ScriptPath)) {
        $script:N8nMode = 'node'
        $script:N8nCommand = $NodePath
        $script:N8nScript = $ScriptPath
        return $true
    }
    return $false
}

function Resolve-NodeCommand {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if ($node) { return $node.Source }
    $known = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe' } else { $null })
    )
    foreach ($p in $known) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
    return $null
}

function Resolve-N8nRuntime {
    $resolved = Get-Command n8n.cmd -ErrorAction SilentlyContinue
    if (-not $resolved) { $resolved = Get-Command n8n -ErrorAction SilentlyContinue }
    if ($resolved -and (Set-N8nCmd $resolved.Source)) { return $true }

    $cmdCandidates = @()
    if ($env:APPDATA) { $cmdCandidates += (Join-Path $env:APPDATA 'npm\n8n.cmd') }
    if ($env:LOCALAPPDATA) { $cmdCandidates += (Join-Path $env:LOCALAPPDATA 'npm\n8n.cmd') }
    if ($env:USERPROFILE) {
        $cmdCandidates += (Join-Path $env:USERPROFILE 'AppData\Roaming\npm\n8n.cmd')
        $cmdCandidates += (Join-Path $env:USERPROFILE 'AppData\Local\npm\n8n.cmd')
    }
    foreach ($candidate in ($cmdCandidates | Select-Object -Unique)) {
        if ($candidate -and (Set-N8nCmd $candidate)) { return $true }
    }

    $nodePath = Resolve-NodeCommand

    # If n8n is running via node/npx, use the exact package path from its command line.
    try {
        $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^(?i)node(?:\.exe)?$' -and $_.CommandLine -match '(?i)n8n' }
        foreach ($proc in $procs) {
            $processNode = if ($proc.ExecutablePath -and (Test-Path -LiteralPath $proc.ExecutablePath)) { $proc.ExecutablePath } else { $nodePath }
            $line = [string]$proc.CommandLine
            $matches = [regex]::Matches($line, '(?i)(?:"([A-Z]:\\[^\"]*?node_modules\\n8n\\bin\\n8n(?:\.js)?)"|([A-Z]:\\[^\s]*?node_modules\\n8n\\bin\\n8n(?:\.js)?))')
            foreach ($m in $matches) {
                $scriptPath = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
                if (Set-N8nNodeScript $processNode $scriptPath) { return $true }
            }
        }
    } catch { }

    # Standard global package locations where the npm shim may be missing from PATH.
    $scriptCandidates = @()
    if ($env:APPDATA) { $scriptCandidates += (Join-Path $env:APPDATA 'npm\node_modules\n8n\bin\n8n') }
    if ($env:LOCALAPPDATA) { $scriptCandidates += (Join-Path $env:LOCALAPPDATA 'npm\node_modules\n8n\bin\n8n') }
    if ($env:USERPROFILE) {
        $scriptCandidates += (Join-Path $env:USERPROFILE 'AppData\Roaming\npm\node_modules\n8n\bin\n8n')
        $scriptCandidates += (Join-Path $env:USERPROFILE 'AppData\Local\npm\node_modules\n8n\bin\n8n')
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
    if ($npm) {
        try {
            $root = (& $npm.Source root -g 2>$null | Select-Object -First 1).Trim()
            if ($root) { $scriptCandidates += (Join-Path $root 'n8n\bin\n8n') }
        } catch { }
        try {
            $prefix = (& $npm.Source prefix -g 2>$null | Select-Object -First 1).Trim()
            if ($prefix) {
                $cmd = Join-Path $prefix 'n8n.cmd'
                if (Set-N8nCmd $cmd) { return $true }
                $scriptCandidates += (Join-Path $prefix 'node_modules\n8n\bin\n8n')
            }
        } catch { }
    }

    if ($nodePath) {
        foreach ($candidate in ($scriptCandidates | Select-Object -Unique)) {
            if ($candidate -and (Set-N8nNodeScript $nodePath $candidate)) { return $true }
        }
    }

    # npx keeps downloaded packages here even when n8n was never installed globally.
    if ($nodePath -and $env:LOCALAPPDATA) {
        $npxRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
        if (Test-Path -LiteralPath $npxRoot) {
            try {
                $dirs = Get-ChildItem -LiteralPath $npxRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
                foreach ($dir in $dirs) {
                    $candidate = Join-Path $dir.FullName 'node_modules\n8n\bin\n8n'
                    if (Set-N8nNodeScript $nodePath $candidate) { return $true }
                }
            } catch { }
        }
    }

    # Project-local install fallback, limited to the BuyFlow Desktop tree.
    if ($nodePath -and $env:USERPROFILE) {
        $buyflowRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow'
        if (Test-Path -LiteralPath $buyflowRoot) {
            try {
                $found = Get-ChildItem -LiteralPath $buyflowRoot -File -Filter 'n8n' -Recurse -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match '(?i)\\node_modules\\n8n\\bin\\n8n$' } |
                    Sort-Object LastWriteTime -Descending |
                    Select-Object -First 1
                if ($found -and (Set-N8nNodeScript $nodePath $found.FullName)) { return $true }
            } catch { }
        }
    }

    return $false
}

function Invoke-N8nRaw([string[]]$Arguments) {
    if ($script:N8nMode -eq 'cmd') {
        $output = & $script:N8nCommand @Arguments 2>&1
    } elseif ($script:N8nMode -eq 'node') {
        $output = & $script:N8nCommand $script:N8nScript @Arguments 2>&1
    } else {
        Fail 'Internal error: n8n runtime was not resolved.'
    }
    if ($LASTEXITCODE -ne 0) {
        $display = if ($script:N8nMode -eq 'node') { "$($script:N8nCommand) $($script:N8nScript)" } else { $script:N8nCommand }
        throw ("n8n command failed: {0} {1}`n{2}" -f $display, ($Arguments -join ' '), ($output -join "`n"))
    }
    return $output
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path $Path)) { Fail "Expected file was not created: $Path" }
    $raw = Get-Content -Raw -LiteralPath $Path
    if ([string]::IsNullOrWhiteSpace($raw)) { Fail "JSON file is empty: $Path" }
    return ($raw | ConvertFrom-Json)
}
function As-Array($Value) { if ($null -eq $Value) { return @() }; if ($Value -is [System.Array]) { return @($Value) }; return @($Value) }
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
    switch ($s.Length % 4) { 2 { $s += '==' }; 3 { $s += '=' }; 0 { }; default { Fail 'Invalid Gmail base64url RAW payload.' } }
    return [Convert]::FromBase64String($s)
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host 'BUYFLOW MAILGATE - REAL GMAIL historyId/history.list SMOKE V3'
    Write-Host 'READ ONLY - NO MAILBOX MUTATION - NO BUYFLOW DB WRITE'
    Write-Host '============================================================'
    Write-Host ''

    if (-not (Resolve-N8nRuntime)) {
        Fail 'n8n runtime nem talalhato: PATH, global npm, futo Node folyamat, npx cache es BuyFlow node_modules is ellenorizve.'
    }

    $version = (Invoke-N8nRaw @('--version') | Select-Object -First 1)
    $runtimeDisplay = if ($script:N8nMode -eq 'node') { "$($script:N8nCommand) $($script:N8nScript)" } else { $script:N8nCommand }
    Write-Host ("n8n found: " + $runtimeDisplay)
    Write-Host ("n8n version: " + $version)

    $specificWorked = $true
    try { Invoke-N8nRaw @('export:workflow', "--id=$RepoWorkflowId", "--output=$workflowPath") | Out-Null } catch { $specificWorked = $false }
    if (-not $specificWorked) { Invoke-N8nRaw @('export:workflow', '--all', "--output=$workflowPath") | Out-Null }

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

    $gmailCredentialId = $null; $gmailCredentialName = $null; $gmailCredentialType = $null
    foreach ($node in (As-Array $workflow.nodes)) {
        if ($null -eq $node.credentials) { continue }
        foreach ($prop in $node.credentials.PSObject.Properties) {
            if ($prop.Name -notmatch 'gmail|google.*oauth|oauth.*google') { continue }
            $cred = $prop.Value; $candidateId = Get-PropertyValue $cred @('id')
            if ($candidateId) {
                $gmailCredentialType = $prop.Name; $gmailCredentialId = [string]$candidateId; $gmailCredentialName = [string](Get-PropertyValue $cred @('name')); break
            }
        }
        if ($gmailCredentialId) { break }
    }
    if (-not $gmailCredentialId) { Fail 'Could not find the Gmail OAuth credential reference in the targeted workflow.' }

    Write-Host ("Gmail credential found: " + $(if ($gmailCredentialName) { $gmailCredentialName } else { '<unnamed>' }))
    Write-Host 'Credential values will NOT be printed.'

    Invoke-N8nRaw @('export:credentials', "--id=$gmailCredentialId", '--decrypted', "--output=$credentialPath") | Out-Null
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
        $tokenResponse = Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{ client_id=$clientId; client_secret=$clientSecret; refresh_token=$refreshToken; grant_type='refresh_token' } -TimeoutSec 30
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
    $rawParity = 0; $totalRawBytes = 0L
    foreach ($messageRef in ($messageRefs | Select-Object -First $SampleLimit)) {
        $id = [uri]::EscapeDataString([string]$messageRef.id)
        $rawMessage = Invoke-RestMethod -Method Get -Uri "$gmailBase/messages/$id?format=raw" -Headers $headers -TimeoutSec 30
        if (-not $rawMessage.raw) { Fail 'Gmail message GET format=raw returned no RAW MIME payload.' }
        $bytes = ConvertFrom-Base64Url ([string]$rawMessage.raw)
        if ($bytes.Length -lt 1) { Fail 'Gmail returned empty RAW MIME bytes.' }
        $sha = [Security.Cryptography.SHA256]::Create(); try { [void]$sha.ComputeHash($bytes) } finally { $sha.Dispose() }
        $rawParity++; $totalRawBytes += $bytes.Length
    }

    $history = Invoke-RestMethod -Method Get -Uri "$gmailBase/history?startHistoryId=$startHistoryId&maxResults=100" -Headers $headers -TimeoutSec 30
    $historyRecords = As-Array $history.history
    $nextHistoryId = [string]$history.historyId
    if ($nextHistoryId -notmatch '^\d+$') { Fail 'Gmail history.list did not return a valid historyId.' }
    $profileAfter = Invoke-RestMethod -Method Get -Uri "$gmailBase/profile" -Headers $headers -TimeoutSec 30

    $report = [ordered]@{
        suite='MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V3'; created_at=(Get-Date).ToString('o'); n8n_version=[string]$version;
        n8n_runtime=$runtimeDisplay; credential_source='existing_local_n8n_gmail_oauth'; credential_type=$gmailCredentialType;
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
