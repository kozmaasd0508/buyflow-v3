import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_URL='https://api.openai.com/v1/responses';
const MODELS=['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol'];
const EVENTS=['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'];
const PERSPECTIVES=['buyer','merchant_outbound','non_purchase'];
const LINKS=['linked','unresolved','not_applicable'];
const FIELDS=['event_type','perspective','order_id','tracking_id','link_status'];
const EXPECTED_SELECTION_SHA='32fe2fcbeaeba08594eac5d1f6c56f1449a86d568487b73e68c3346db67f5b5d';
const EXPECTED_NORMALIZER='normalized-email-document-v1.1';

// Frozen Prompt V2. Keep byte-for-byte semantics aligned with the H1 V2 benchmark runner.
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
async function callModel(apiKey,model,emailText){const retry=[1000,2500,6000];for(let attempt=0;;attempt++){const res=await fetch(API_URL,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:SYSTEM,input:`Email:\n\n${emailText}`,reasoning:{effort:'low'},text:{verbosity:'low',format:{type:'json_schema',name:'buyflow_email_classification',strict:true,schema:SCHEMA}},max_output_tokens:512,store:false})});if(res.ok){const data=await res.json();const text=extractOutputText(data);if(!text)throw new Error(`OPENAI_NO_OUTPUT:${model}`);return{pred:safePrediction(JSON.parse(text)),usage:data.usage??{},resolved:data.model??model};}const detail=await res.text().catch(()=>'');if([408,429,500,502,503,504].includes(res.status)&&attempt<retry.length){await sleep(retry[attempt]);continue;}throw new Error(`OPENAI_HTTP_${res.status}:${model}:${detail.slice(0,200)}`);}}
function same(a,b){return FIELDS.every(f=>a?.[f]===b?.[f]);}

async function main(){
  const bundlePath=process.argv[2];
  const outPath=process.argv[3]||path.join(path.dirname(bundlePath),'real60-h1-maillens-v1.1-prompt-v2-predictions-private-local.json');
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!bundlePath)throw new Error('USAGE: <rebuilt-bundle.json> [out.json]');
  if(!apiKey)throw new Error('OPENAI_API_KEY_MISSING');
  const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
  if(bundle?.benchmark!=='buyflow-real60-h1-blind-maillens-v1.1-rebuild')throw new Error('BUNDLE_BENCHMARK_INVALID');
  if(bundle?.selection_sha256!==EXPECTED_SELECTION_SHA)throw new Error('BUNDLE_SELECTION_SHA_INVALID');
  if(!Array.isArray(bundle?.cases)||bundle.cases.length!==60)throw new Error('BUNDLE_CASES_INVALID');
  if(bundle?.model_predictions_included!==false)throw new Error('BUNDLE_PREDICTIONS_FLAG_INVALID');
  for(const c of bundle.cases){if(c?.mail_lens_normalizer!==EXPECTED_NORMALIZER)throw new Error(`BUNDLE_NORMALIZER_INVALID:${c?.case_id}`);}

  console.log('==============================================================');
  console.log('BUYFLOW REAL60 H1 - MAILLENS v1.1 + FROZEN PROMPT V2');
  console.log('60 corrected full-body cases | Luna + Terra + Sol');
  console.log('Prediction only: NO reference/gold labels are provided to models.');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  const rows=[];
  const usage=Object.fromEntries(MODELS.map(m=>[m,{input_tokens:0,output_tokens:0,reasoning_tokens:0}]));
  let errors=0,all3Agree=0,lunaSolAgree=0,terraSolAgree=0;
  for(let i=0;i<bundle.cases.length;i++){
    const c=bundle.cases[i];
    const emailText=`Feladó: ${c.from??''}\nTárgy: ${c.subject??''}\n\n${c.semantic_text??''}`;
    const row={case_id:c.case_id,predictions:{},error:null};
    try{
      const results=await Promise.all(MODELS.map(m=>callModel(apiKey,m,emailText)));
      for(let k=0;k<MODELS.length;k++){
        const model=MODELS[k],r=results[k];
        row.predictions[model]=r.pred;
        usage[model].input_tokens+=Number(r.usage?.input_tokens??0);
        usage[model].output_tokens+=Number(r.usage?.output_tokens??0);
        usage[model].reasoning_tokens+=Number(r.usage?.output_tokens_details?.reasoning_tokens??0);
      }
      const l=row.predictions[MODELS[0]],t=row.predictions[MODELS[1]],s=row.predictions[MODELS[2]];
      if(same(l,t)&&same(t,s))all3Agree++;
      if(same(l,s))lunaSolAgree++;
      if(same(t,s))terraSolAgree++;
      console.log(`[${String(i+1).padStart(2,'0')}/60] ${c.case_id} OK | all3=${same(l,t)&&same(t,s)?'YES':'NO'}`);
    }catch(e){
      errors++;
      row.error=e instanceof Error?e.message:String(e);
      console.log(`[${String(i+1).padStart(2,'0')}/60] ${c.case_id} ERROR ${row.error}`);
    }
    rows.push(row);
  }
  const summary={
    benchmark:'buyflow-real60-h1-maillens-v1.1-prompt-v2-predictions',
    prompt_version:'merchant-outbound-linking-v2-frozen',
    created_at:new Date().toISOString(),
    selection_sha256:bundle.selection_sha256,
    mail_lens_normalizer:EXPECTED_NORMALIZER,
    total:60,
    technical_errors:errors,
    agreement:{all3_exact:all3Agree,luna_sol_exact:lunaSolAgree,terra_sol_exact:terraSolAgree},
    usage,
    safety:{gmail_calls:0,buyflow_writes:0,production_off:true,blind_o3_used:false,openai_store:false},
    gold_labels_included:false,
    rows
  };
  await writeFile(outPath,JSON.stringify(summary,null,2)+'\n','utf8');
  console.log('');
  console.log('================ H1 v1.1 PREDICTIONS READY ================');
  console.log(`Technical errors: ${errors}`);
  console.log(`All 3 exact agreement: ${all3Agree}/60`);
  console.log(`Luna = Sol exact agreement: ${lunaSolAgree}/60`);
  console.log(`Terra = Sol exact agreement: ${terraSolAgree}/60`);
  for(const model of MODELS){const u=usage[model];console.log(`${model} tokens: in=${u.input_tokens} out=${u.output_tokens} reasoning=${u.reasoning_tokens}`);}
  console.log(`Result: ${outPath}`);
  console.log('Upload ONLY the predictions result file back to ChatGPT for scoring.');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('===========================================================');
}

main().catch(e=>{console.error(`REAL60_H1_V11_FATAL: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
