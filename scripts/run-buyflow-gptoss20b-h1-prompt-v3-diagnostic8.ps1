$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$model='gpt-oss:20b'
$ollamaUrl='http://127.0.0.1:11434/api/chat'
$tagsUrl='http://127.0.0.1:11434/api/tags'
$expectedSelection='32fe2fcbeaeba08594eac5d1f6c56f1449a86d568487b73e68c3346db67f5b5d'
$expectedNormalizer='normalized-email-document-v1.1'
$caseIds=@('H1-003','H1-008','H1-010','H1-035','H1-037','H1-045','H1-046','H1-052')
$events=@('ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER')
$perspectives=@('buyer','merchant_outbound','non_purchase')
$links=@('linked','unresolved','not_applicable')

$SYSTEM=@'
You are BuyFlow EventMind. Classify ONE email into the CURRENT buyer-side commerce lifecycle state.
Return exactly one JSON object with exactly these keys:
event_type, perspective, order_id, tracking_id, link_status
Do not explain. Do not add keys. Do not invent identifiers.

Allowed event_type:
ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER
Allowed perspective: buyer, merchant_outbound, non_purchase
Allowed link_status: linked, unresolved, not_applicable

DECISION PROCEDURE. Follow in this exact order.

STEP 1 - PERSPECTIVE GATE. Decide the mailbox owner's role BEFORE event type.
A. buyer:
- the mailbox owner is the shopper, customer, recipient, subscriber, payer, or returner of their own purchase.
B. merchant_outbound:
- the mailbox owner is acting as seller/shipper/merchant and a carrier is collecting, booking, transporting, or administering parcels FROM the mailbox owner toward the mailbox owner's customers.
- carrier pickup/collection jobs FROM the mailbox owner are merchant_outbound even when the email sender is a courier company.
- a pickup request, pickup booking, collection job, collection reference, service-order reference, or courier acceptance of a pickup job is NOT evidence that the mailbox owner is the buyer.
C. non_purchase:
- marketing, survey, account/security, preference, generic information, subscription administration not representing a current purchase lifecycle event, or other non-purchase content.

HARD PERSPECTIVE CONSISTENCY:
- If perspective=merchant_outbound: order_id=null, tracking_id=null, link_status=not_applicable.
- If perspective=non_purchase: normally order_id=null, tracking_id=null, link_status=not_applicable.
- Never convert a carrier pickup-job ID into a buyer order_id or tracking_id.

STEP 2 - CURRENT STATE ONLY.
Classify only what is directly true NOW in the current email.
- Future plans, future handoff, future cancellation, future delivery, expectations, estimates, instructions, and possibilities are NOT current events.
- A future dated cancellation is not CANCELLED yet.
- A future carrier handoff is not SHIPPED yet.
- Prefer the newest/current message state over quoted or historical text.

STEP 3 - EVENT BOUNDARIES.
ORDER_CREATED = buyer order received/confirmed/accepted; no later processing state.
ORDER_PROCESSING = order is being prepared/processed/packed; carrier handoff has not happened and no shipment/tracking creation is directly asserted.
SHIPMENT_CREATED = shipment/label/tracking/pre-advice/parcel record has been created or prepared, but physical handoff to carrier has not happened.
SHIPPED = carrier physically collected/accepted the parcel from the sender. Do not use SHIPPED merely because a pickup job was accepted/scheduled.
IN_TRANSIT = parcel is actually moving/processed inside carrier network after handoff.
OUT_FOR_DELIVERY = parcel is with local courier/vehicle for recipient delivery now/today.
READY_FOR_PICKUP = parcel is physically at locker/pickup point and available to recipient.
DELIVERED = recipient handoff completed.
PAYMENT = payment completed/confirmed.
INVOICE = invoice issued/sent.
CANCELLED = cancellation already effective/completed now.
REFUNDED = money actually returned/completed.
RETURN = returned parcel physically received by merchant/returns warehouse.
OTHER = no allowed current lifecycle state is directly asserted.

IMPORTANT SHIPPING DISTINCTIONS:
- 'pickup job accepted', 'collection booked', 'courier will collect', 'pickup scheduled' -> NOT SHIPPED. First determine whether this is merchant_outbound. If buyer-side and only a shipment/pickup record exists, use SHIPMENT_CREATED.
- 'parcel prepared/registered with carrier' without physical handoff -> SHIPMENT_CREATED.
- 'handed to carrier', 'carrier collected', 'accepted parcel physically' -> SHIPPED.
- 'at depot/warehouse/sorting/network movement' -> IN_TRANSIT.
- 'courier has it for delivery today' -> OUT_FOR_DELIVERY.

STEP 4 - IDENTIFIER TYPING. Type IDs by what the email explicitly calls them, not by shape.
order_id:
- only an identifier explicitly called order/order number/purchase order/megrendeles/rendelesszam or equivalent buyer order identifier.
tracking_id:
- only an identifier explicitly called tracking number, parcel number, package number, shipment number, waybill, consignment number, csomagszam, parcel ID, tracking ID, or equivalent shipment identifier.
- A parcel/package/csomag number MUST NOT be placed in order_id.
- A buyer order number MUST NOT be placed in tracking_id.
- Invoice numbers, transaction IDs, document IDs, pickup-job IDs, carrier service-order IDs, booking IDs, and generic references are neither unless explicitly identified as buyer order/tracking IDs.
- A tracking number found only inside an unambiguous carrier tracking URL may be used as tracking_id only when it is clearly the parcel identifier for this email.

STEP 5 - LINK STATUS LAST.
linked = an exact buyer order_id is present for this event, OR the email explicitly verifies a relation between buyer order_id and tracking_id.
unresolved = buyer-side lifecycle event exists but no exact buyer purchase link is established.
not_applicable = merchant_outbound or non_purchase, or no buyer purchase link is required.
- tracking_id alone does NOT make link_status=linked.
- a parcel number alone does NOT make link_status=linked.

FINAL SILENT VALIDATION BEFORE OUTPUT:
1. Did I decide perspective before event?
2. If merchant_outbound, are both IDs null and link_status not_applicable?
3. Is the event current, not future?
4. Did I keep order_id and tracking_id in the correct fields?
5. If only tracking_id exists, is link_status unresolved unless an explicit order-to-tracking relation is present?
6. Is the JSON valid and limited to the five required keys?
'@

function Get-Prop($o,[string]$name){
  if($null -eq $o){ return $null }
  $p=$o.PSObject.Properties[$name]
  if($null -eq $p){ return $null }
  return $p.Value
}
function Parse-JsonContent([string]$text){
  $t=$text.Trim()
  if($t.StartsWith('```')){
    $t=$t -replace '^```(?:json)?\s*',''
    $t=$t -replace '\s*```$',''
  }
  try { return ($t | ConvertFrom-Json) } catch {}
  $start=$t.IndexOf('{'); $end=$t.LastIndexOf('}')
  if($start -ge 0 -and $end -gt $start){ return ($t.Substring($start,$end-$start+1) | ConvertFrom-Json) }
  throw ('MODEL_OUTPUT_NOT_JSON: '+$t.Substring(0,[Math]::Min(120,$t.Length)))
}
function Normalize-Prediction($v){
  $event=[string](Get-Prop $v 'event_type')
  $perspective=[string](Get-Prop $v 'perspective')
  $link=[string](Get-Prop $v 'link_status')
  if($events -notcontains $event){ throw ('BAD_EVENT_TYPE:'+ $event) }
  if($perspectives -notcontains $perspective){ throw ('BAD_PERSPECTIVE:'+ $perspective) }
  if($links -notcontains $link){ throw ('BAD_LINK_STATUS:'+ $link) }
  $oid=Get-Prop $v 'order_id'; if($null -ne $oid){$oid=[string]$oid;if([string]::IsNullOrWhiteSpace($oid)){$oid=$null}}
  $tid=Get-Prop $v 'tracking_id'; if($null -ne $tid){$tid=[string]$tid;if([string]::IsNullOrWhiteSpace($tid)){$tid=$null}}
  return [ordered]@{event_type=$event;perspective=$perspective;order_id=$oid;tracking_id=$tid;link_status=$link}
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
Write-Host 'BUYFLOW GPT-OSS 20B - H1 PROMPT V3 DIAGNOSTIC 8' -ForegroundColor Cyan
Write-Host 'Prompt V3 targets role, ID typing, current-state and shipment boundaries.' -ForegroundColor Yellow
Write-Host 'MailLens v1.1 | local Ollama only | no OpenAI | no Gmail | no BuyFlow writes.' -ForegroundColor Green
Write-Host 'Production OFF. O3 NOT USED.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$bundle=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real60-h1-blind-bundle-maillens-v1.1-private-local.json' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(-not $bundle){ throw 'MAILLENS_V11_H1_BUNDLE_NOT_FOUND' }
$raw=[System.IO.File]::ReadAllText($bundle.FullName,[System.Text.Encoding]::UTF8)
$doc=$raw | ConvertFrom-Json
if([string]$doc.selection_sha256 -ne $expectedSelection){ throw 'SELECTION_SHA_MISMATCH' }
if(-not $doc.cases -or @($doc.cases).Count -ne 60){ throw 'EXPECTED_60_CASES' }
$versions=@($doc.cases | ForEach-Object {$_.mail_lens_normalizer} | Sort-Object -Unique)
if($versions.Count -ne 1 -or $versions[0] -ne $expectedNormalizer){ throw ('NORMALIZER_MISMATCH:'+($versions -join ',')) }
$h1012=$doc.cases | Where-Object {$_.case_id -eq 'H1-012'} | Select-Object -First 1
$expectedSubject='Dinamikus csomagk'+[char]0x00F6+'vet'+[char]0x00E9+'s - GLS'
if(-not $h1012 -or [string]$h1012.subject -ne $expectedSubject){ throw ('UTF8_DECODE_SANITY_FAILED:H1-012:'+([string]$h1012.subject)) }
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
  $emailText="From: $($c.from)`nSubject: $($c.subject)`n`n$($c.semantic_text)"
  $sw=[System.Diagnostics.Stopwatch]::StartNew()
  $row=[ordered]@{case_id=$caseId;prediction=$null;error=$null;elapsed_ms=$null;thinking=$null;raw_content=$null}
  try {
    $r=Invoke-GptOss $emailText
    $sw.Stop()
    $content=[string](Get-Prop (Get-Prop $r 'message') 'content')
    $thinking=[string](Get-Prop (Get-Prop $r 'message') 'thinking')
    $pred=Normalize-Prediction (Parse-JsonContent $content)
    $row.prediction=$pred
    $row.elapsed_ms=$sw.ElapsedMilliseconds
    $row.thinking=$thinking
    $row.raw_content=$content
    Write-Host ('[{0}] {1} | {2} | order={3} | tracking={4} | {5} | {6}ms' -f $caseId,$pred.event_type,$pred.perspective,$pred.order_id,$pred.tracking_id,$pred.link_status,$sw.ElapsedMilliseconds) -ForegroundColor Green
  } catch {
    $sw.Stop()
    $row.error=$_.Exception.Message
    $row.elapsed_ms=$sw.ElapsedMilliseconds
    Write-Host ('['+$caseId+'] ERROR '+$row.error) -ForegroundColor Red
  }
  $rows += [pscustomobject]$row
}

$outPath=Join-Path $bundle.Directory.FullName 'real60-h1-gpt-oss20b-prompt-v3-diagnostic8-private-local.json'
$result=[ordered]@{
  diagnostic='buyflow-gpt-oss20b-h1-prompt-v3-diagnostic8'
  created_at=(Get-Date).ToUniversalTime().ToString('o')
  model=$model
  prompt_version='gpt-oss-local-v3-diagnostic'
  selection_sha256=$expectedSelection
  mail_lens_normalizer=$expectedNormalizer
  cases=$caseIds
  rows=$rows
  safety=[ordered]@{local_ollama_only=$true;openai_calls=0;gmail_calls=0;buyflow_writes=0;production_off=$true;blind_o3_used=$false}
}
$result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $outPath -Encoding UTF8
Write-Host ''
Write-Host ('Result: '+$outPath) -ForegroundColor Cyan
Write-Host 'Diagnostic only: H1 is a tuning set, not a clean holdout.' -ForegroundColor Yellow
