import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_URL = 'https://api.openai.com/v1/responses';
const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];
const EVENTS = ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'];
const PERSPECTIVES = ['buyer','merchant_outbound','non_purchase'];
const LINKS = ['linked','unresolved','not_applicable'];
const FIELDS = ['event_type','perspective','order_id','tracking_id','link_status'];

const SYSTEM = `Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts.
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

const SCHEMA = {
  type: 'object',
  properties: {
    event_type: { type: 'string', enum: EVENTS },
    perspective: { type: 'string', enum: PERSPECTIVES },
    order_id: { type: ['string','null'] },
    tracking_id: { type: ['string','null'] },
    link_status: { type: 'string', enum: LINKS },
  },
  required: FIELDS,
  additionalProperties: false,
};

const REFERENCE = {
  'R120-002':['SHIPPED','buyer',null,null,'unresolved'],
  'R120-003':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-005':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-010':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-014':['SHIPPED','buyer','2608319163','2746595832','linked'],
  'R120-015':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-018':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-019':['PAYMENT','merchant_outbound',null,null,'not_applicable'],
  'R120-020':['ORDER_PROCESSING','buyer','2608319163',null,'linked'],
  'R120-021':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-041':['INVOICE','buyer',null,null,'unresolved'],
  'R120-043':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-049':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-052':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-054':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-057':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-061':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-065':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-066':['INVOICE','buyer',null,null,'unresolved'],
  'R120-067':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-072':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-074':['SHIPPED','buyer',null,null,'unresolved'],
  'R120-076':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-077':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-084':['OTHER','buyer',null,null,'not_applicable'],
  'R120-085':['SHIPPED','buyer',null,'16380143879559','unresolved'],
  'R120-086':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-089':['OUT_FOR_DELIVERY','buyer',null,'16380124260518','unresolved'],
  'R120-090':['SHIPPED','buyer',null,'16380124260518','unresolved'],
  'R120-096':['SHIPMENT_CREATED','buyer',null,'16380124260518','unresolved'],
  'R120-106':['ORDER_PROCESSING','buyer','192132',null,'linked'],
  'R120-110':['PAYMENT','buyer',null,null,'unresolved'],
  'R120-113':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-116':['SHIPMENT_CREATED','merchant_outbound',null,null,'not_applicable'],
  'R120-119':['SHIPPED','buyer','Z 349 3891 717',null,'linked'],
};

function refPred(caseId) {
  const x = REFERENCE[caseId];
  if (!x) throw new Error(`REFERENCE_MISSING:${caseId}`);
  return { event_type:x[0], perspective:x[1], order_id:x[2], tracking_id:x[3], link_status:x[4] };
}
function same(a,b,fields=FIELDS){ return fields.every(f => a?.[f] === b?.[f]); }
function extractOutputText(data){
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts=[];
  for (const item of data?.output ?? []) if (item?.type === 'message') for (const c of item?.content ?? []) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  return parts.join('').trim();
}
function safePrediction(value){
  if (!value || typeof value !== 'object') throw new Error('OUTPUT_NOT_OBJECT');
  const p={event_type:value.event_type,perspective:value.perspective,order_id:value.order_id ?? null,tracking_id:value.tracking_id ?? null,link_status:value.link_status};
  if (!EVENTS.includes(p.event_type)) throw new Error('BAD_EVENT_TYPE');
  if (!PERSPECTIVES.includes(p.perspective)) throw new Error('BAD_PERSPECTIVE');
  if (!LINKS.includes(p.link_status)) throw new Error('BAD_LINK_STATUS');
  return p;
}
async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function callModel(apiKey,model,emailText){
  const retry=[1000,2500,6000];
  for(let attempt=0;;attempt++){
    const res=await fetch(API_URL,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:SYSTEM,input:`Email:\n\n${emailText}`,reasoning:{effort:'low'},text:{verbosity:'low',format:{type:'json_schema',name:'buyflow_email_classification',strict:true,schema:SCHEMA}},max_output_tokens:512,store:false})});
    if(res.ok){ const data=await res.json(); const text=extractOutputText(data); if(!text) throw new Error(`OPENAI_NO_OUTPUT:${model}`); return {pred:safePrediction(JSON.parse(text)),usage:data.usage ?? {},resolved:data.model ?? model}; }
    const detail=await res.text().catch(()=> '');
    if([408,429,500,502,503,504].includes(res.status) && attempt<retry.length){ await sleep(retry[attempt]); continue; }
    throw new Error(`OPENAI_HTTP_${res.status}:${model}:${detail.slice(0,200)}`);
  }
}
function blankStats(){ return {exact:0,event_type:0,perspective:0,order_id:0,tracking_id:0,link_status:0,merchant_exact:0,merchant_total:0,buyer_exact:0,buyer_total:0,input_tokens:0,output_tokens:0,reasoning_tokens:0}; }

async function main(){
  const bundlePath=process.argv[2];
  const outPath=process.argv[3] || path.join(path.dirname(bundlePath),'prompt-v2-results-private-local.json');
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!bundlePath) throw new Error('USAGE: <blind-bundle.json> [output.json]');
  if(!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
  if(bundle?.benchmark !== 'buyflow-real120-blind-adjudication-v1') throw new Error('WRONG_BUNDLE');
  if(bundle?.frozen_real120_sha256 !== '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470') throw new Error('BUNDLE_SHA_MISMATCH');
  if(bundle?.model_predictions_included !== false || !Array.isArray(bundle?.cases) || bundle.cases.length !== 35) throw new Error('BUNDLE_INVALID');

  console.log('==============================================================');
  console.log('BUYFLOW REAL120 DISAGREEMENT35 - PROMPT V2');
  console.log('35 measured disagreement cases | existing MailLens bundle');
  console.log('Luna + Terra + Sol on all 35 | reference labels used ONLY after model calls');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  const stats=Object.fromEntries(MODELS.map(m=>[m,blankStats()]));
  const rows=[];
  let errors=0;
  for(let i=0;i<bundle.cases.length;i++){
    const c=bundle.cases[i];
    const gold=refPred(c.case_id);
    const emailText=`Feladó: ${c.from ?? ''}\nTárgy: ${c.subject ?? ''}\n\n${c.semantic_text ?? ''}`;
    const row={case_id:c.case_id,reference:gold,predictions:{},error:null};
    try{
      const results=await Promise.all(MODELS.map(m=>callModel(apiKey,m,emailText)));
      for(let k=0;k<MODELS.length;k++){
        const model=MODELS[k], r=results[k], p=r.pred, s=stats[model];
        row.predictions[model]=p;
        if(same(p,gold)) s.exact++;
        for(const f of FIELDS) if(p[f]===gold[f]) s[f]++;
        if(gold.perspective==='merchant_outbound'){s.merchant_total++; if(same(p,gold)) s.merchant_exact++;}
        if(gold.perspective==='buyer'){s.buyer_total++; if(same(p,gold)) s.buyer_exact++;}
        s.input_tokens += Number(r.usage?.input_tokens ?? 0);
        s.output_tokens += Number(r.usage?.output_tokens ?? 0);
        s.reasoning_tokens += Number(r.usage?.output_tokens_details?.reasoning_tokens ?? 0);
      }
      console.log(`[${String(i+1).padStart(2,'0')}/35] ${c.case_id} OK | Luna=${same(row.predictions[MODELS[0]],gold)?'PASS':'FAIL'} Terra=${same(row.predictions[MODELS[1]],gold)?'PASS':'FAIL'} Sol=${same(row.predictions[MODELS[2]],gold)?'PASS':'FAIL'}`);
    }catch(e){ errors++; row.error=e instanceof Error?e.message:String(e); console.log(`[${String(i+1).padStart(2,'0')}/35] ${c.case_id} ERROR ${row.error}`); }
    rows.push(row);
  }

  const summary={benchmark:'buyflow-real120-disagreement35-prompt-v2',prompt_version:'merchant-outbound-linking-v2',created_at:new Date().toISOString(),frozen_real120_sha256:bundle.frozen_real120_sha256,total:35,technical_errors:errors,reference_is_working_chatgpt_blind_adjudication:true,reference_not_frozen_real120_gold:true,models:stats,safety:{gmail_calls:0,buyflow_writes:0,production_off:true,blind_o3_used:false,openai_store:false}};
  await writeFile(outPath,JSON.stringify({...summary,rows},null,2)+'\n','utf8');

  console.log('');
  console.log('================ PROMPT V2 RESULT ================');
  for(const model of MODELS){
    const s=stats[model];
    console.log(`${model}`);
    console.log(`  EXACT:        ${s.exact}/35 = ${(100*s.exact/35).toFixed(1)}%`);
    console.log(`  event_type:   ${s.event_type}/35 = ${(100*s.event_type/35).toFixed(1)}%`);
    console.log(`  perspective:  ${s.perspective}/35 = ${(100*s.perspective/35).toFixed(1)}%`);
    console.log(`  order_id:     ${s.order_id}/35 = ${(100*s.order_id/35).toFixed(1)}%`);
    console.log(`  tracking_id:  ${s.tracking_id}/35 = ${(100*s.tracking_id/35).toFixed(1)}%`);
    console.log(`  link_status:  ${s.link_status}/35 = ${(100*s.link_status/35).toFixed(1)}%`);
    console.log(`  merchant:     ${s.merchant_exact}/${s.merchant_total}`);
    console.log(`  buyer:        ${s.buyer_exact}/${s.buyer_total}`);
    console.log(`  tokens:       in=${s.input_tokens} out=${s.output_tokens} reasoning=${s.reasoning_tokens}`);
  }
  console.log(`Technical errors: ${errors}`);
  console.log(`Result: ${outPath}`);
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('NOTE: reference = working blind adjudication for tuning, NOT frozen REAL120 gold.');
  console.log('==================================================');
}

main().catch(e=>{console.error(`PROMPT_V2_FATAL: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
