$ErrorActionPreference = 'Stop'

$endpoint = 'http://127.0.0.1:5678/webhook/buyflow-gmail-targeted-test-v2'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $env:USERPROFILE ("Desktop\BuyFlow-REAL-GMAIL-BATCH19-$stamp.json")

$cases = @(
    [ordered]@{ id='RG19-01'; gmail_id='1a04738dd7b7f0b2'; source='Express One'; expected_event='SHIPMENT_CREATED'; expected_action='REVIEW'; note='Pickup job accepted, physical pickup still later' },
    [ordered]@{ id='RG19-02'; gmail_id='1a042eeb8b5b0093'; source='GLS Automata'; expected_event='READY_FOR_PICKUP'; expected_action='REVIEW'; note='Parcel placed in locker, pickup code available' },
    [ordered]@{ id='RG19-03'; gmail_id='1a03d020616afc46'; source='GLS'; expected_event='OUT_FOR_DELIVERY'; expected_action='REVIEW'; note='Delivery planned today' },
    [ordered]@{ id='RG19-04'; gmail_id='1a039c6464b57d6d'; source='Dorko'; expected_event='SHIPPED'; expected_action='REVIEW'; note='Order handed to GLS courier' },
    [ordered]@{ id='RG19-05'; gmail_id='1a04268e187a031e'; source='PUELLA'; expected_event='ORDER_CREATED'; expected_action='CREATE_PURCHASE'; note='New order received' },
    [ordered]@{ id='RG19-06'; gmail_id='1a0287a8ee3ed4de'; source='Sportvision'; expected_event='ORDER_CREATED'; expected_action='CREATE_PURCHASE'; note='New order confirmation' },
    [ordered]@{ id='RG19-07'; gmail_id='1a03aa36969b7803'; source='Limone'; expected_event='ORDER_CREATED'; expected_action='CREATE_PURCHASE'; note='Automated order confirmation' },
    [ordered]@{ id='RG19-08'; gmail_id='19fd7aa55cd22c40'; source='FNP'; expected_event='ORDER_PROCESSING'; expected_action='REVIEW'; note='Order received and currently processing' },
    [ordered]@{ id='RG19-09'; gmail_id='19fcc88745e98f77'; source='Gyerekjatekbolt'; expected_event='PAYMENT'; expected_action='REVIEW'; note='Successful card payment state' },
    [ordered]@{ id='RG19-10'; gmail_id='19fd39e6cc7e2368'; source='Gyerekjatekbolt'; expected_event='SHIPPED'; expected_action='REVIEW'; note='Handed to courier / shipping in progress' },
    [ordered]@{ id='RG19-11'; gmail_id='19fd631576f9d368'; source='Gyerekjatekbolt'; expected_event='DELIVERED'; expected_action='REVIEW'; note='Order delivered' },
    [ordered]@{ id='RG19-12'; gmail_id='19fcc81f29bd10da'; source='Gyerekjatekbolt'; expected_event='CANCELLED'; expected_action='REVIEW'; note='Order cancelled' },
    [ordered]@{ id='RG19-13'; gmail_id='1a03aa427124c336'; source='Limone'; expected_event='PAYMENT'; expected_action='REVIEW'; note='Payment successfully completed' },
    [ordered]@{ id='RG19-14'; gmail_id='1a039c674225b1df'; source='Playersroom'; expected_event='INVOICE'; expected_action='REVIEW'; note='Electronic invoice arrived' },
    [ordered]@{ id='RG19-15'; gmail_id='1a0114f63076825e'; source='Replit Stripe'; expected_event='REFUNDED'; expected_action='REVIEW'; note='Refund issued' },
    [ordered]@{ id='RG19-16'; gmail_id='1a0486bc0c9456ed'; source='Express One marketing'; expected_event='OTHER'; expected_action='IGNORE'; note='Star courier marketing/newsletter' },
    [ordered]@{ id='RG19-17'; gmail_id='1a04426675d27e76'; source='GLS survey'; expected_event='OTHER'; expected_action='IGNORE'; note='Satisfaction survey' },
    [ordered]@{ id='RG19-18'; gmail_id='1a039ddbae998af5'; source='McDonalds'; expected_event='PAYMENT'; expected_action='REVIEW'; note='Payment confirmation without purchase candidates' },
    [ordered]@{ id='RG19-19'; gmail_id='1a0384c35340f022'; source='SimplePay'; expected_event='PAYMENT'; expected_action='REVIEW'; note='Successful payment' }
)

Write-Host ''
Write-Host '============================================================'
Write-Host 'BUYFLOW REAL GMAIL TARGETED BATCH19'
Write-Host '19 real Gmail messages -> local Qwen Agent+Critic V4'
Write-Host '============================================================'
Write-Host ''

try {
    $probe = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -TimeoutSec 5
} catch {
    Write-Host 'HIBA: n8n nem erheto el a 127.0.0.1:5678 cimen.' -ForegroundColor Red
    Read-Host 'Nyomj Entert a bezarashoz'
    exit 1
}

$results = @()
$index = 0
foreach ($case in $cases) {
    $index++
    Write-Host ("[$index/19] {0} - {1}" -f $case.id, $case.source)
    $row = [ordered]@{
        id = $case.id
        gmail_id = $case.gmail_id
        source = $case.source
        note = $case.note
        expected_event = $case.expected_event
        expected_action = $case.expected_action
        actual_event = $null
        actual_action = $null
        selected_purchase_id = $null
        confidence = $null
        ruleset = $null
        shadow_safe = $false
        write_performed = $null
        unsafe_link = $false
        exact = $false
        error = $null
        guardrails = @()
        reason = $null
    }
    try {
        $uri = "$endpoint?message_id=$($case.gmail_id)"
        $r = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 300
        $d = $r.buyflow_result.decision
        $row.actual_event = $d.event_type
        $row.actual_action = $d.action
        $row.selected_purchase_id = $d.selected_purchase_id
        $row.confidence = $d.confidence
        $row.ruleset = $r.buyflow_result.ruleset
        $row.write_performed = $r.write_performed
        $row.guardrails = @($r.buyflow_result.guardrails_applied)
        $row.reason = $d.reason
        $row.shadow_safe = (
            $r.shadow_only -eq $true -and
            $r.write_performed -eq $false -and
            $r.buyflow_result.mode -eq 'SHADOW' -and
            $r.buyflow_result.execution_allowed -eq $false
        )
        $row.unsafe_link = ($d.action -eq 'LINK_EXISTING')
        $row.exact = (
            $d.event_type -eq $case.expected_event -and
            $d.action -eq $case.expected_action -and
            $null -eq $d.selected_purchase_id
        )
        if ($row.exact) { Write-Host '  PASS' -ForegroundColor Green }
        else { Write-Host ("  FAIL expected {0}/{1}, got {2}/{3}" -f $case.expected_event,$case.expected_action,$d.event_type,$d.action) -ForegroundColor Yellow }
    } catch {
        $row.error = $_.Exception.Message
        Write-Host ('  ERROR: ' + $row.error) -ForegroundColor Red
    }
    $results += [pscustomobject]$row
}

$exactCount = @($results | Where-Object exact).Count
$eventCount = @($results | Where-Object { $_.actual_event -eq $_.expected_event }).Count
$actionCount = @($results | Where-Object { $_.actual_action -eq $_.expected_action }).Count
$shadowCount = @($results | Where-Object shadow_safe).Count
$rulesetCount = @($results | Where-Object { $_.ruleset -eq 'agent-critic-v4' }).Count
$unsafeCount = @($results | Where-Object unsafe_link).Count
$errorCount = @($results | Where-Object { $_.error }).Count
$selectedNonNull = @($results | Where-Object { $null -ne $_.selected_purchase_id }).Count
$percent = [math]::Round(($exactCount / $cases.Count) * 100, 2)
$gate = ($exactCount -ge 17 -and $unsafeCount -eq 0 -and $errorCount -eq 0 -and $shadowCount -eq 19 -and $rulesetCount -eq 19 -and $selectedNonNull -eq 0)

$report = [ordered]@{
    suite = 'REAL_GMAIL_TARGETED_BATCH19_V1'
    created_at = (Get-Date).ToString('o')
    total = $cases.Count
    exact = $exactCount
    exact_percent = $percent
    event_correct = $eventCount
    action_correct = $actionCount
    shadow_safe = $shadowCount
    ruleset_v4 = $rulesetCount
    unsafe_links = $unsafeCount
    selected_purchase_non_null = $selectedNonNull
    errors = $errorCount
    gate = if ($gate) { 'PASS' } else { 'REVIEW' }
    results = $results
}

$json = $report | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($reportPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host '==================== SUMMARY ==================='
Write-Host ("Exact:        {0}/19 ({1}%%)" -f $exactCount,$percent)
Write-Host ("Event:        {0}/19" -f $eventCount)
Write-Host ("Action:       {0}/19" -f $actionCount)
Write-Host ("SHADOW safe:  {0}/19" -f $shadowCount)
Write-Host ("Ruleset V4:   {0}/19" -f $rulesetCount)
Write-Host ("Unsafe links: {0}" -f $unsafeCount)
Write-Host ("Errors:       {0}" -f $errorCount)
if ($gate) { Write-Host 'GATE: PASS' -ForegroundColor Green } else { Write-Host 'GATE: REVIEW' -ForegroundColor Yellow }
Write-Host ('Report: ' + $reportPath)
Write-Host '================================================'
Write-Host ''

$failed = @($results | Where-Object { -not $_.exact -or $_.error })
if ($failed.Count -gt 0) {
    Write-Host 'FAIL/REVIEW cases:'
    foreach ($f in $failed) {
        if ($f.error) {
            Write-Host ("- {0} {1}: ERROR {2}" -f $f.id,$f.source,$f.error)
        } else {
            Write-Host ("- {0} {1}: expected {2}/{3}, got {4}/{5}" -f $f.id,$f.source,$f.expected_event,$f.expected_action,$f.actual_event,$f.actual_action)
        }
    }
    Write-Host ''
}

Read-Host 'Nyomj Entert a bezarashoz'
