$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$model='gpt-oss:20b'
$ollamaUrl='http://127.0.0.1:11434/api/chat'
$tagsUrl='http://127.0.0.1:11434/api/tags'
$expectedSelection='32fe2fcbeaeba08594eac5d1f6c56f1449a86d568487b73e68c3346db67f5b5d'
$expectedNormalizer='normalized-email-document-v1.1'
$caseIds=@('H1-003','H1-008','H1-012','H1-035','H1-052')

$SYSTEM=@'
Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts.
Allowed event_type: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
Allowed perspective: buyer, merchant_outbound, non_purchase.
Allowed link_status: linked, unresolved, not_applicable.

Decision order — follow this order strictly:
1. Determine perspective first.
2. Determine the current directly asserted event state.
3. Extract only explicitly identified buyer-side order/tracking IDs.
4. Determine link_status last.

Perspective:
- buyer = mailbox owner is the customer/recipient side, even if sender is merchant, warehouse, payment provider, invoice provider or carrier.
- merchant_outbound = mailbox owner is acting as seller/shipper and the message concerns pickup, fulfillment or delivery of parcels from the mailbox owner to the mailbox owner's own customers.
- non_purchase = marketing, security, survey, preference or other non-purchase content.
- A carrier message about collecting a parcel FROM the mailbox owner/sender is merchant_outbound, not buyer.
- A courier accepting a pickup/collection job from the sender does not mean a buyer-side parcel is being delivered.

Hard merchant-outbound rules:
- If perspective = merchant_outbound, link_status MUST be not_applicable.
- If perspective = merchant_outbound, order_id MUST be null and tracking_id MUST be null for BuyFlow buyer-side linking.
- Pickup-job IDs, collection-request IDs, fulfillment references and carrier booking references are NOT buyer order IDs or buyer tracking IDs.

Linking:
- linked = buyer-side lifecycle event with an exact buyer order id present for this event, or an explicit verified buyer order-to-tracking relation.
- unresolved = buyer-side purchase lifecycle event but no exact purchase link is available, or multiple purchase candidates remain.
- not_applicable = merchant_outbound or non_purchase, or otherwise no buyer purchase lifecycle linking is required.

Lifecycle boundaries:
- SHIPMENT_CREATED = label/pre-advice/tracking/collection booking created, or pickup accepted/scheduled, but physical carrier handoff has not yet occurred.
- SHIPPED = carrier physically collected/accepted the parcel from sender; no later network movement is the current state.
- IN_TRANSIT = parcel is moving/processed inside carrier network; a failed delivery followed by return to depot is IN_TRANSIT.
- OUT_FOR_DELIVERY = assigned to local courier/vehicle for today's recipient-delivery route.
- READY_FOR_PICKUP = physically at locker/pickup point and available for collection by recipient.
- DELIVERED = recipient handoff completed.
- REFUNDED = money was actually returned/completed.
- RETURN = returned parcel was physically received by merchant/returns warehouse.
- Refund request, refund processing started, return request or return-label creation alone are not REFUNDED/RETURN; use OTHER when no settled lifecycle event occurred.
- If a message says a parcel/order will be handed to the carrier shortly, that future handoff is not SHIPPED yet; use the current preparation/processing state.
- Prefer current message state over quoted/older history.
- Ignore example IDs, coupon-like codes, invoice/document numbers, transaction IDs and generic reference numbers unless the email explicitly identifies them as a buyer order ID or buyer tracking/shipment ID.
'@

function Get-Prop($o,[string]$name){
  if($null -eq $o){ return $null }
  $p=$o.PSObject.Properties[$name]
  if($null -eq $p){ return $null }
  return $p.Value
}

function Invoke-GptOss([string]$emailText){
  $payload=[ordered]@{
    model=$model
    stream=$false
    think='low'
    keep_alive='30m'
    messages=@(
      @{role='system';content=$SYSTEM},
      @{role='user';content=("Email:`n`n"+$emailText)}
    )
    options=@{temperature=0;num_predict=1536;num_ctx=8192}
  }
  $json=$payload | ConvertTo-Json -Depth 20 -Compress
  $bytes=[System.Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method Post -Uri $ollamaUrl -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 900
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW GPT-OSS 20B - H1 DIAGNOSTIC 5 V2' -ForegroundColor Cyan
Write-Host 'Technical-fix rerun only: explicit UTF-8 + think=low + 1536 output tokens.' -ForegroundColor Yellow
Write-Host 'Same MailLens v1.1 + SAME frozen Prompt V2.' -ForegroundColor Green
Write-Host 'LOCAL OLLAMA ONLY. NO OpenAI. NO Gmail. NO BuyFlow writes.' -ForegroundColor Green
Write-Host 'Production OFF. O3 NOT USED.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real60-h1-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $bundle){ throw 'MAILLENS_V11_H1_BUNDLE_NOT_FOUND' }

# Windows PowerShell 5.1 otherwise may decode UTF-8-without-BOM using the legacy ANSI code page.
$raw=[System.IO.File]::ReadAllText($bundle.FullName,[System.Text.Encoding]::UTF8)
$doc=$raw | ConvertFrom-Json
if([string]$doc.selection_sha256 -ne $expectedSelection){ throw 'SELECTION_SHA_MISMATCH' }
if(-not $doc.cases -or @($doc.cases).Count -ne 60){ throw 'EXPECTED_60_CASES' }
$versions=@($doc.cases | ForEach-Object {$_.mail_lens_normalizer} | Sort-Object -Unique)
if($versions.Count -ne 1 -or $versions[0] -ne $expectedNormalizer){ throw ('NORMALIZER_MISMATCH:'+($versions -join ',')) }

# Catch the exact mojibake pattern seen in diagnostic V1 before asking the model anything.
$mojibake=@($doc.cases | Where-Object { ([string]$_.subject) -match 'Ă|Ĺ|Ã|Â' })
if($mojibake.Count -gt 0){ throw ('UTF8_DECODE_SANITY_FAILED:'+($mojibake[0].case_id)+':'+$mojibake[0].subject) }

try { $tags=Invoke-RestMethod -Method Get -Uri $tagsUrl -TimeoutSec 15 } catch { throw 'OLLAMA_API_NOT_REACHABLE' }
$names=@($tags.models | ForEach-Object {$_.name})
if($names -notcontains $model){ throw ('MODEL_NOT_INSTALLED:'+ $model) }

Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray
Write-Host ('Model: '+$model+' OK') -ForegroundColor Green
Write-Host 'UTF-8 sanity: PASS' -ForegroundColor Green

$rows=@()
foreach($caseId in $caseIds){
  $c=$doc.cases | Where-Object {$_.case_id -eq $caseId} | Select-Object -First 1
  if(-not $c){ throw ('CASE_NOT_FOUND:'+ $caseId) }

  $emailText="Feladó: $($c.from)`nTárgy: $($c.subject)`n`n$($c.semantic_text)"
  $sw=[System.Diagnostics.Stopwatch]::StartNew()
  $row=[ordered]@{
    case_id=$caseId
    from=$c.from
    subject=$c.subject
    semantic_text_length=([string]$c.semantic_text).Length
    elapsed_ms=$null
    http_ok=$false
    done_reason=$null
    message_content=$null
    message_content_length=0
    thinking_present=$false
    thinking_length=0
    raw_response=$null
    error=$null
  }

  try {
    $r=Invoke-GptOss $emailText
    $sw.Stop()
    $content=[string](Get-Prop (Get-Prop $r 'message') 'content')
    $thinking=[string](Get-Prop (Get-Prop $r 'message') 'thinking')
    $row.http_ok=$true
    $row.elapsed_ms=$sw.ElapsedMilliseconds
    $row.done_reason=[string](Get-Prop $r 'done_reason')
    $row.message_content=$content
    $row.message_content_length=$content.Length
    $row.thinking_present=(-not [string]::IsNullOrWhiteSpace($thinking))
    $row.thinking_length=$thinking.Length
    $row.raw_response=$r

    Write-Host ''
    Write-Host ('--- '+$caseId+' ---') -ForegroundColor Cyan
    Write-Host ('Subject: '+$c.subject) -ForegroundColor DarkGray
    Write-Host ('HTTP: OK | '+$sw.ElapsedMilliseconds+' ms | done='+$row.done_reason+' | content chars='+$content.Length+' | thinking chars='+$thinking.Length) -ForegroundColor Green
    Write-Host 'MODEL CONTENT:' -ForegroundColor Yellow
    if([string]::IsNullOrWhiteSpace($content)){ Write-Host '<EMPTY>' -ForegroundColor Red } else { Write-Host $content }
  } catch {
    $sw.Stop()
    $row.elapsed_ms=$sw.ElapsedMilliseconds
    $row.error=$_.Exception.Message
    Write-Host ''
    Write-Host ('--- '+$caseId+' ---') -ForegroundColor Cyan
    Write-Host ('ERROR: '+$row.error) -ForegroundColor Red
  }

  $rows += [pscustomobject]$row
}

$outPath=Join-Path $bundle.Directory.FullName 'real60-h1-gpt-oss20b-diagnostic5-v2-private-local.json'
$result=[ordered]@{
  diagnostic='buyflow-gpt-oss20b-h1-diagnostic5-v2'
  created_at=(Get-Date).ToUniversalTime().ToString('o')
  model=$model
  prompt_version='merchant-outbound-linking-v2-frozen'
  selection_sha256=$expectedSelection
  mail_lens_normalizer=$expectedNormalizer
  technical_changes=@('explicit_utf8_decode','think_low','num_predict_1536')
  cases=$caseIds
  rows=$rows
  safety=[ordered]@{
    local_ollama_only=$true
    openai_calls=0
    gmail_calls=0
    buyflow_writes=0
    production_off=$true
    blind_o3_used=$false
  }
}
$result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $outPath -Encoding UTF8

Write-Host ''
Write-Host '================ DIAGNOSTIC V2 COMPLETE ================' -ForegroundColor Cyan
Write-Host ('Result: '+$outPath) -ForegroundColor Cyan
Write-Host 'NO OpenAI | NO Gmail | BuyFlow writes 0 | Production OFF | O3 NOT USED' -ForegroundColor Green
Write-Host '=========================================================' -ForegroundColor Cyan