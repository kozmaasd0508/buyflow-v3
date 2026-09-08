import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_URL='https://api.openai.com/v1/responses';
const MODEL='gpt-5.6-luna';
const EVENTS=['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'];
const PERSPECTIVES=['buyer','merchant_outbound','non_purchase'];
const LINKS=['linked','unresolved','not_applicable'];
const FIELDS=['event_type','perspective','order_id','tracking_id','link_status'];
const EXPECTED_SELECTION_SHA='0161411f2e6d5ecfac675ea78318495bc263b241c72b191f897371cc469a6164';
const EXPECTED_NORMALIZER='normalized-email-document-v1.1';
const EXPECTED_BENCHMARK='buyflow-real100-h2-blind-maillens-v1.1-v2';

// Frozen Prompt V2. Semantics intentionally match the earlier H1 V2 benchmark runner.
const SYSTEM=`Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts.
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
- Ignore example IDs, coupon-like codes, invoice/document numbers, transaction IDs and generic reference numbers unless the email explicitly identifies them as a buyer order ID or buyer tracking/shipment ID.`;

const SCHEMA={type:'object',properties:{event_type:{type:'string',enum:EVENTS},perspective:{type:'string',enum:PERSPECTIVES},order_id:{type:['string','null']},tracking_id:{type:['string','null']},link_status:{type:'string',enum:LINKS}},required:FIELDS,additionalProperties:false};

function extractOutputText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const parts=[];for(const item of d?.output??[])if(item?.type==='message')for(const c of item?.content??[])if(c?.type==='output_text'&&typeof c.text==='string')parts.push(c.text);return parts.join('').trim();}
function safePrediction(v){if(!v||typeof v!=='object')throw new Error('OUTPUT_NOT_OBJECT');const p={event_type:v.event_type,perspective:v.perspective,order_id:v.order_id??null,tracking_id:v.tracking_id??null,link_status:v.link_status};if(!EVENTS.includes(p.event_type))throw new Error('BAD_EVENT_TYPE');if(!PERSPECTIVES.includes(p.perspective))throw new Error('BAD_PERSPECTIVE');if(!LINKS.includes(p.link_status))throw new Error('BAD_LINK_STATUS');return p;}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function callLuna(apiKey,emailText){const retry=[1000,2500,6000];for(let attempt=0;;attempt++){const res=await fetch(API_URL,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,instructions:SYSTEM,input:`Email:\n\n${emailText}`,reasoning:{effort:'low'},text:{verbosity:'low',format:{type:'json_schema',name:'buyflow_email_classification',strict:true,schema:SCHEMA}},max_output_tokens:512,store:false})});if(res.ok){const data=await res.json();const text=extractOutputText(data);if(!text)throw new Error('OPENAI_NO_OUTPUT');return{pred:safePrediction(JSON.parse(text)),usage:data.usage??{},resolved:data.model??MODEL};}const detail=await res.text().catch(()=>'');if([408,429,500,502,503,504].includes(res.status)&&attempt<retry.length){await sleep(retry[attempt]);continue;}throw new Error(`OPENAI_HTTP_${res.status}:${detail.slice(0,300)}`);}}

async function main(){
  const bundlePath=process.argv[2];
  const outPath=process.argv[3]||path.join(path.dirname(bundlePath),'real100-h2-maillens-v1.1-prompt-v2-luna-only-predictions-private-local.json');
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!bundlePath)throw new Error('USAGE: <h2-bundle.json> [out.json]');
  if(!apiKey)throw new Error('OPENAI_API_KEY_MISSING');
  const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
  if(bundle?.benchmark!==EXPECTED_BENCHMARK)throw new Error(`BUNDLE_BENCHMARK_INVALID:${bundle?.benchmark}`);
  if(bundle?.selection_sha256!==EXPECTED_SELECTION_SHA)throw new Error('BUNDLE_SELECTION_SHA_INVALID');
  if(!Array.isArray(bundle?.cases)||bundle.cases.length!==100)throw new Error('BUNDLE_CASES_INVALID');
  if(bundle?.model_predictions_included!==false)throw new Error('BUNDLE_PREDICTIONS_FLAG_INVALID');
  if(bundle?.gold_labels_included!==false)throw new Error('BUNDLE_GOLD_FLAG_INVALID');
  for(const c of bundle.cases){if(c?.mail_lens_normalizer!==EXPECTED_NORMALIZER)throw new Error(`BUNDLE_NORMALIZER_INVALID:${c?.case_id}`);}

  console.log('==============================================================');
  console.log('BUYFLOW REAL100 H2 - MAILLENS v1.1 + FROZEN PROMPT V2');
  console.log('LUNA ONLY | 100 real blind Gmail purchase-category emails');
  console.log('Prediction only: NO gold/reference labels are provided to Luna.');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  const rows=[];
  const usage={input_tokens:0,output_tokens:0,reasoning_tokens:0};
  let errors=0;
  const started=Date.now();
  for(let i=0;i<bundle.cases.length;i++){
    const c=bundle.cases[i];
    const emailText=`Feladó: ${c.from??''}\nTárgy: ${c.subject??''}\n\n${c.semantic_text??''}`;
    const row={case_id:c.case_id,prediction:null,error:null,elapsed_ms:null};
    const t0=Date.now();
    try{
      const r=await callLuna(apiKey,emailText);
      row.prediction=r.pred;
      usage.input_tokens+=Number(r.usage?.input_tokens??0);
      usage.output_tokens+=Number(r.usage?.output_tokens??0);
      usage.reasoning_tokens+=Number(r.usage?.output_tokens_details?.reasoning_tokens??0);
      row.elapsed_ms=Date.now()-t0;
      console.log(`[${String(i+1).padStart(3,'0')}/100] ${c.case_id} OK ${row.elapsed_ms}ms`);
    }catch(e){
      errors++;
      row.error=e instanceof Error?e.message:String(e);
      row.elapsed_ms=Date.now()-t0;
      console.log(`[${String(i+1).padStart(3,'0')}/100] ${c.case_id} ERROR ${row.error}`);
    }
    rows.push(row);
  }
  const summary={
    benchmark:'buyflow-real100-h2-maillens-v1.1-prompt-v2-luna-only-predictions',
    prompt_version:'merchant-outbound-linking-v2-frozen',
    created_at:new Date().toISOString(),
    selection_sha256:bundle.selection_sha256,
    mail_lens_normalizer:EXPECTED_NORMALIZER,
    model:MODEL,
    total:100,
    technical_errors:errors,
    elapsed_ms:Date.now()-started,
    usage,
    safety:{gmail_calls:0,buyflow_writes:0,production_off:true,blind_o3_used:false,openai_store:false},
    gold_labels_included:false,
    rows
  };
  await writeFile(outPath,JSON.stringify(summary,null,2)+'\n','utf8');
  console.log('');
  console.log('================ H2 LUNA PREDICTIONS READY ================');
  console.log(`Technical errors: ${errors}/100`);
  console.log(`Luna tokens: in=${usage.input_tokens} out=${usage.output_tokens} reasoning=${usage.reasoning_tokens}`);
  console.log(`Elapsed: ${((Date.now()-started)/1000).toFixed(1)} sec`);
  console.log(`Result: ${outPath}`);
  console.log('Upload ONLY this predictions result file back to ChatGPT for scoring.');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('===========================================================');
}

main().catch(e=>{console.error(`REAL100_H2_LUNA_FATAL: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
