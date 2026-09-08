$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$model='gpt-oss:20b'
$ollamaUrl='http://127.0.0.1:11434/api/chat'
$tagsUrl='http://127.0.0.1:11434/api/tags'
$expectedSelection='32fe2fcbeaeba08594eac5d1f6c56f1449a86d568487b73e68c3346db67f5b5d'
$expectedNormalizer='normalized-email-document-v1.1'
$events=@('ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER')
$perspectives=@('buyer','merchant_outbound','non_purchase')
$links=@('linked','unresolved','not_applicable')

$SYSTEM=@'
Classify this commerce email for BuyFlow. Return ONLY one strict JSON object with exactly these keys: event_type, perspective, order_id, tracking_id, link_status. No markdown, no explanation, no extra text. Do not invent facts.
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

function Fail([string]$m){ throw $m }
function Get-Prop($o,[string]$name){
  if($null -eq $o){ return $null }
  $p=$o.PSObject.Properties[$name]
  if($null -eq $p){ return $null }
  return $p.Value
}
function Get-ErrorText($err){
  try {
    if($err.ErrorDetails -and -not [string]::IsNullOrWhiteSpace([string]$err.ErrorDetails.Message)){
      return [string]$err.ErrorDetails.Message
    }
  } catch {}
  try {
    $resp=$err.Exception.Response
    if($null -ne $resp){
      $stream=$resp.GetResponseStream()
      if($null -ne $stream){
        $reader=New-Object System.IO.StreamReader($stream)
        $body=$reader.ReadToEnd()
        if(-not [string]::IsNullOrWhiteSpace($body)){ return $body }
      }
    }
  } catch {}
  return [string]$err.Exception.Message
}
function Parse-JsonContent([string]$text){
  $t=$text.Trim()
  if($t.StartsWith('```')){
    $t=$t -replace '^```(?:json)?\s*',''
    $t=$t -replace '\s*```$',''
  }
  try { return ($t | ConvertFrom-Json) } catch {}
  $start=$t.IndexOf('{'); $end=$t.LastIndexOf('}')
  if($start -ge 0 -and $end -gt $start){
    return ($t.Substring($start,$end-$start+1) | ConvertFrom-Json)
  }
  Fail ('MODEL_OUTPUT_NOT_JSON: '+($t.Substring(0,[Math]::Min(220,$t.Length))))
}
function Normalize-Prediction($v){
  $event=[string](Get-Prop $v 'event_type')
  $perspective=[string](Get-Prop $v 'perspective')
  $link=[string](Get-Prop $v 'link_status')
  if($events -notcontains $event){ Fail ('BAD_EVENT_TYPE:'+ $event) }
  if($perspectives -notcontains $perspective){ Fail ('BAD_PERSPECTIVE:'+ $perspective) }
  if($links -notcontains $link){ Fail ('BAD_LINK_STATUS:'+ $link) }
  $oid=Get-Prop $v 'order_id'; if($null -ne $oid){$oid=[string]$oid;if([string]::IsNullOrWhiteSpace($oid)){$oid=$null}}
  $tid=Get-Prop $v 'tracking_id'; if($null -ne $tid){$tid=[string]$tid;if([string]::IsNullOrWhiteSpace($tid)){$tid=$null}}
  return [ordered]@{event_type=$event;perspective=$perspective;order_id=$oid;tracking_id=$tid;link_status=$link}
}
function Invoke-LocalModel([string]$emailText){
  # IMPORTANT: no Ollama `format` field here. gpt-oss has had compatibility problems
  # with structured-output format/schema handling. We enforce JSON in the prompt and parse it ourselves.
  $payload=[ordered]@{
    model=$model
    stream=$false
    think=$false
    keep_alive='30m'
    messages=@(
      @{role='system';content=$SYSTEM},
      @{role='user';content=("Email:`n`n"+$emailText)}
    )
    options=@{temperature=0;num_predict=512;num_ctx=8192}
  }
  $json=$payload | ConvertTo-Json -Depth 20 -Compress
  $bytes=[System.Text.Encoding]::UTF8.GetBytes($json)
  try {
    return Invoke-RestMethod -Method Post -Uri $ollamaUrl -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 900
  } catch {
    $detail=Get-ErrorText $_
    throw ('OLLAMA_HTTP_ERROR: '+$detail)
  }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW REAL60 H1 - LOCAL GPT-OSS 20B / MAILLENS v1.1 V2' -ForegroundColor Cyan
Write-Host 'Same 60 H1 emails + frozen Prompt V2.' -ForegroundColor Green
Write-Host 'LOCAL OLLAMA ONLY. NO OpenAI API. NO Gmail calls.' -ForegroundColor Green
Write-Host 'BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
Write-Host 'Ollama structured format/schema disabled for gpt-oss compatibility.' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Cyan

$bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real60-h1-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $bundle){ Fail 'MAILLENS_V11_H1_BUNDLE_NOT_FOUND' }
Write-Host ('Bundle: '+$bundle.FullName) -ForegroundColor DarkGray

$doc=Get-Content -Raw -LiteralPath $bundle.FullName | ConvertFrom-Json
if([string]$doc.selection_sha256 -ne $expectedSelection){ Fail 'SELECTION_SHA_MISMATCH' }
if(-not $doc.cases -or @($doc.cases).Count -ne 60){ Fail 'EXPECTED_60_CASES' }
$versions=@($doc.cases | ForEach-Object {$_.mail_lens_normalizer} | Sort-Object -Unique)
if($versions.Count -ne 1 -or $versions[0] -ne $expectedNormalizer){ Fail ('NORMALIZER_MISMATCH:'+($versions -join ',')) }
if((Get-Prop $doc 'model_predictions_included') -eq $true){ Fail 'BUNDLE_CONTAINS_MODEL_PREDICTIONS' }

try { $tags=Invoke-RestMethod -Method Get -Uri $tagsUrl -TimeoutSec 15 } catch { Fail 'OLLAMA_API_NOT_REACHABLE' }
$names=@($tags.models | ForEach-Object {$_.name})
if($names -notcontains $model){ Fail ('MODEL_NOT_INSTALLED:'+ $model) }
Write-Host ('Model: '+$model+' OK') -ForegroundColor Green

# One compatibility preflight. If this fails, stop before wasting 60 requests.
Write-Host 'Preflight: testing gpt-oss /api/chat without format/schema...' -ForegroundColor Yellow
try {
  $pre=Invoke-LocalModel "Feladó: shop@example.com`nTárgy: Rendelés visszaigazolva`n`nA 12345 számú rendelésedet megkaptuk."
  $preContent=[string]$pre.message.content
  $null=Normalize-Prediction (Parse-JsonContent $preContent)
  Write-Host 'Preflight: PASS' -ForegroundColor Green
} catch {
  Write-Host ('Preflight: FAIL - '+$_.Exception.Message) -ForegroundColor Red
  Fail 'LOCAL_GPT_OSS_PREFLIGHT_FAILED'
}

$rows=@(); $errors=0
$start=Get-Date
for($i=0;$i -lt 60;$i++){
  $c=$doc.cases[$i]
  $caseId=[string]$c.case_id
  $emailText="Feladó: $($c.from)`nTárgy: $($c.subject)`n`n$($c.semantic_text)"
  $sw=[System.Diagnostics.Stopwatch]::StartNew()
  $row=[ordered]@{case_id=$caseId;prediction=$null;error=$null;elapsed_ms=$null;ollama=@{}}
  try {
    $r=Invoke-LocalModel $emailText
    $content=[string]$r.message.content
    $pred=Normalize-Prediction (Parse-JsonContent $content)
    $sw.Stop()
    $row.prediction=$pred
    $row.elapsed_ms=$sw.ElapsedMilliseconds
    $row.ollama=[ordered]@{
      total_duration=Get-Prop $r 'total_duration'
      load_duration=Get-Prop $r 'load_duration'
      prompt_eval_count=Get-Prop $r 'prompt_eval_count'
      eval_count=Get-Prop $r 'eval_count'
      eval_duration=Get-Prop $r 'eval_duration'
    }
    Write-Host ('[{0:D2}/60] {1} OK  {2}  {3}ms' -f ($i+1),$caseId,$pred.event_type,$sw.ElapsedMilliseconds) -ForegroundColor Green
  } catch {
    $sw.Stop(); $errors++
    $row.error=$_.Exception.Message
    $row.elapsed_ms=$sw.ElapsedMilliseconds
    Write-Host ('[{0:D2}/60] {1} ERROR {2}' -f ($i+1),$caseId,$row.error) -ForegroundColor Red
  }
  $rows += [pscustomobject]$row
}
$elapsed=[math]::Round(((Get-Date)-$start).TotalSeconds,1)

$outPath=Join-Path $bundle.Directory.FullName 'real60-h1-maillens-v1.1-prompt-v2-gpt-oss20b-predictions-private-local.json'
$result=[ordered]@{
  benchmark='buyflow-real60-h1-maillens-v1.1-prompt-v2-gpt-oss20b-local'
  prompt_version='merchant-outbound-linking-v2-frozen'
  created_at=(Get-Date).ToUniversalTime().ToString('o')
  selection_sha256=$expectedSelection
  mail_lens_normalizer=$expectedNormalizer
  model=$model
  total=60
  technical_errors=$errors
  elapsed_seconds=$elapsed
  gold_labels_included=$false
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
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $outPath -Encoding UTF8

Write-Host ''
Write-Host '================ LOCAL GPT-OSS RESULT ================' -ForegroundColor Cyan
Write-Host ('Completed:        '+(60-$errors)+'/60')
Write-Host ('Technical errors: '+$errors)
Write-Host ('Elapsed seconds:  '+$elapsed)
Write-Host ('Result:           '+$outPath) -ForegroundColor Cyan
Write-Host 'NO OpenAI API | NO Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Cyan