$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoWorkflowId = 'bf-gmail-targeted-test-v2'
$TargetWebhookPath = 'buyflow-gmail-targeted-test-v2'
$SampleLimit = 6
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $env:USERPROFILE ("Desktop\BuyFlow-MAILGATE-HISTORY-SMOKE-$stamp.json")
$tempRoot = Join-Path $env:TEMP ("buyflow-mailgate-history-v4-" + [guid]::NewGuid().ToString('N'))
$workflowPath = Join-Path $tempRoot 'workflow.json'
$credentialPath = Join-Path $tempRoot 'credential.json'
$originalUserFolder = $env:N8N_USER_FOLDER

function Fail([string]$Message) { throw $Message }
function As-Array($Value) { if ($null -eq $Value) { return @() }; if ($Value -is [System.Array]) { return @($Value) }; return @($Value) }
function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { Fail "Expected file was not created: $Path" }
    $raw = Get-Content -Raw -LiteralPath $Path
    if ([string]::IsNullOrWhiteSpace($raw)) { Fail "JSON file is empty: $Path" }
    return ($raw | ConvertFrom-Json)
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
    switch ($s.Length % 4) { 2 { $s += '==' }; 3 { $s += '=' }; 0 { }; default { Fail 'Invalid Gmail base64url RAW payload.' } }
    return [Convert]::FromBase64String($s)
}

$script:N8nMode = $null
$script:N8nCommand = $null
$script:N8nScript = $null

function Set-N8nCmd([string]$Path) {
    if ($Path -and (Test-Path -LiteralPath $Path)) {
        $script:N8nMode = 'cmd'; $script:N8nCommand = $Path; $script:N8nScript = $null; return $true
    }
    return $false
}
function Set-N8nNodeScript([string]$NodePath, [string]$ScriptPath) {
    if ($NodePath -and $ScriptPath -and (Test-Path -LiteralPath $NodePath) -and (Test-Path -LiteralPath $ScriptPath)) {
        $script:N8nMode = 'node'; $script:N8nCommand = $NodePath; $script:N8nScript = $ScriptPath; return $true
    }
    return $false
}
function Resolve-NodeCommand {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if ($node) { return $node.Source }
    $known = @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    if (${env:ProgramFiles(x86)}) { $known += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
    foreach ($p in $known) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
    return $null
}
function Resolve-N8nRuntime {
    $resolved = Get-Command n8n.cmd -ErrorAction SilentlyContinue
    if (-not $resolved) { $resolved = Get-Command n8n -ErrorAction SilentlyContinue }
    if ($resolved -and (Set-N8nCmd $resolved.Source)) { return $true }

    $nodePath = Resolve-NodeCommand
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

    $cmdCandidates = @()
    if ($env:APPDATA) { $cmdCandidates += (Join-Path $env:APPDATA 'npm\n8n.cmd') }
    if ($env:LOCALAPPDATA) { $cmdCandidates += (Join-Path $env:LOCALAPPDATA 'npm\n8n.cmd') }
    foreach ($candidate in ($cmdCandidates | Select-Object -Unique)) { if (Set-N8nCmd $candidate) { return $true } }

    if ($nodePath -and $env:USERPROFILE) {
        $runtimeRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime'
        $candidate = Join-Path $runtimeRoot 'node_modules\n8n\bin\n8n'
        if (Set-N8nNodeScript $nodePath $candidate) { return $true }
    }
    return $false
}
function Invoke-N8nRaw([string[]]$Arguments, [switch]$AllowFailure) {
    if ($script:N8nMode -eq 'cmd') { $output = & $script:N8nCommand @Arguments 2>&1 }
    elseif ($script:N8nMode -eq 'node') { $output = & $script:N8nCommand $script:N8nScript @Arguments 2>&1 }
    else { Fail 'Internal error: n8n runtime was not resolved.' }
    $exit = $LASTEXITCODE
    if ($exit -ne 0 -and -not $AllowFailure) {
        $display = if ($script:N8nMode -eq 'node') { "$($script:N8nCommand) $($script:N8nScript)" } else { $script:N8nCommand }
        throw ("n8n command failed: {0} {1}`n{2}" -f $display, ($Arguments -join ' '), ($output -join "`n"))
    }
    return [pscustomobject]@{ ExitCode = $exit; Output = @($output) }
}

function Add-DbCandidate([System.Collections.Generic.List[string]]$List, [string]$Path) {
    if ($Path -and (Test-Path -LiteralPath $Path -PathType Leaf) -and -not $List.Contains($Path)) { [void]$List.Add($Path) }
}
function Discover-N8nDatabases {
    $dbs = New-Object 'System.Collections.Generic.List[string]'
    if ($env:USERPROFILE) {
        Add-DbCandidate $dbs (Join-Path $env:USERPROFILE '.n8n\database.sqlite')
        $buyflowRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow'
        $known = @(
            (Join-Path $buyflowRoot '.n8n\database.sqlite'),
            (Join-Path $buyflowRoot '.n8n-local-ai-runtime\database.sqlite'),
            (Join-Path $buyflowRoot '.n8n-local-ai-runtime\.n8n\database.sqlite')
        )
        foreach ($p in $known) { Add-DbCandidate $dbs $p }

        if (Test-Path -LiteralPath $buyflowRoot) {
            try {
                $queue = New-Object System.Collections.Queue
                $queue.Enqueue([pscustomobject]@{ Path = $buyflowRoot; Depth = 0 })
                while ($queue.Count -gt 0) {
                    $item = $queue.Dequeue()
                    Add-DbCandidate $dbs (Join-Path $item.Path 'database.sqlite')
                    Add-DbCandidate $dbs (Join-Path $item.Path '.n8n\database.sqlite')
                    if ($item.Depth -ge 3) { continue }
                    foreach ($dir in (Get-ChildItem -LiteralPath $item.Path -Directory -Force -ErrorAction SilentlyContinue)) {
                        if ($dir.Name -in @('node_modules','.git','dist','build')) { continue }
                        $queue.Enqueue([pscustomobject]@{ Path = $dir.FullName; Depth = $item.Depth + 1 })
                    }
                }
            } catch { }
        }
    }
    return @($dbs | Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending)
}
function CandidateUserFoldersForDb([string]$DbPath) {
    $dbDir = Split-Path -Parent $DbPath
    $folders = New-Object 'System.Collections.Generic.List[string]'
    $leaf = Split-Path -Leaf $dbDir
    if ($leaf -eq '.n8n') {
        $parent = Split-Path -Parent $dbDir
        if ($parent) { [void]$folders.Add($parent) }
    }
    [void]$folders.Add($dbDir)
    $parent2 = Split-Path -Parent $dbDir
    if ($parent2 -and -not $folders.Contains($parent2)) { [void]$folders.Add($parent2) }
    return @($folders)
}
function Find-TargetWorkflow($Workflows) {
    foreach ($candidate in (As-Array $Workflows)) {
        $hasTargetWebhook = $false
        foreach ($node in (As-Array $candidate.nodes)) {
            $path = Get-PropertyValue $node.parameters @('path')
            if ([string]$path -eq $TargetWebhookPath) { $hasTargetWebhook = $true; break }
        }
        if ($hasTargetWebhook -or [string]$candidate.id -eq $RepoWorkflowId -or [string]$candidate.name -match 'gmail.*targeted|targeted.*gmail') { return $candidate }
    }
    return $null
}
function Resolve-N8nDataProfile {
    $dbs = Discover-N8nDatabases
    if ($dbs.Count -eq 0) { Fail 'No n8n database.sqlite was found in the known BuyFlow/Windows locations.' }
    Write-Host ("n8n databases found: " + $dbs.Count)

    foreach ($dbPath in $dbs) {
        foreach ($userFolder in (CandidateUserFoldersForDb $dbPath)) {
            if (-not (Test-Path -LiteralPath $userFolder -PathType Container)) { continue }
            $env:N8N_USER_FOLDER = $userFolder
            Remove-Item -LiteralPath $workflowPath -Force -ErrorAction SilentlyContinue
            $r = Invoke-N8nRaw @('export:workflow','--all',"--output=$workflowPath") -AllowFailure
            if ($r.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $workflowPath)) { continue }
            try { $workflows = Read-JsonFile $workflowPath } catch { continue }
            $target = Find-TargetWorkflow $workflows
            if ($target) {
                return [pscustomobject]@{ DbPath = $dbPath; UserFolder = $userFolder; Workflow = $target }
            }
        }
    }
    $safeList = ($dbs | ForEach-Object { $_ }) -join '; '
    Fail ("n8n databases were found, but none contained the BuyFlow targeted Gmail workflow. Databases checked: $safeList")
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host 'BUYFLOW MAILGATE - REAL GMAIL historyId/history.list SMOKE V4'
    Write-Host 'READ ONLY - NO MAILBOX MUTATION - NO BUYFLOW DB WRITE'
    Write-Host '============================================================'
    Write-Host ''

    if (-not (Resolve-N8nRuntime)) { Fail 'n8n runtime not found.' }
    $versionResult = Invoke-N8nRaw @('--version')
    $version = ($versionResult.Output | Select-Object -First 1)
    $runtimeDisplay = if ($script:N8nMode -eq 'node') { "$($script:N8nCommand) $($script:N8nScript)" } else { $script:N8nCommand }
    Write-Host ("n8n found: " + $runtimeDisplay)
    Write-Host ("n8n version: " + $version)

    $profile = Resolve-N8nDataProfile
    $env:N8N_USER_FOLDER = $profile.UserFolder
    $workflow = $profile.Workflow
    Write-Host ("n8n data profile: " + $profile.UserFolder)
    Write-Host ("workflow database: " + $profile.DbPath)

    $gmailCredentialId = $null; $gmailCredentialName = $null; $gmailCredentialType = $null
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
    if (-not $gmailCredentialId) { Fail 'Could not find Gmail OAuth credential reference in the targeted workflow.' }
    Write-Host ("Gmail credential found: " + $(if ($gmailCredentialName) { $gmailCredentialName } else { '<unnamed>' }))
    Write-Host 'Credential values will NOT be printed.'

    Remove-Item -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue
    $credResult = Invoke-N8nRaw @('export:credentials',"--id=$gmailCredentialId",'--decrypted',"--output=$credentialPath")
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
        Fail ("Could not obtain access token from existing Gmail credential. Available credential fields: $fieldNames")
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
        suite='MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V4'; created_at=(Get-Date).ToString('o'); n8n_version=[string]$version;
        n8n_user_folder=$profile.UserFolder; credential_source='existing_local_n8n_gmail_oauth'; credential_type=$gmailCredentialType;
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
    if ($null -eq $originalUserFolder) { Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue } else { $env:N8N_USER_FOLDER = $originalUserFolder }
    if (Test-Path -LiteralPath $credentialPath) { try { Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue } catch { } }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
