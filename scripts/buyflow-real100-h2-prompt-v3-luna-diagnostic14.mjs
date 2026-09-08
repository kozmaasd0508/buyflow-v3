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

const TARGETS=['H2-004','H2-016','H2-037','H2-039','H2-050','H2-061','H2-064','H2-066','H2-073','H2-079','H2-088','H2-091','H2-094','H2-095'];
const EXPECTED={
  'H2-004':{event_type:'SHIPMENT_CREATED',perspective:'merchant_outbound',order_id:null,tracking_id:null,link_status:'not_applicable'},
  'H2-016':{event_type:'IN_TRANSIT',perspective:'buyer',order_id:null,tracking_id:'CLFOX177192400327056',link_status:'unresolved'},
  'H2-037':{event_type:'SHIPPED',perspective:'buyer',order_id:'42710-772939',tracking_id:'CLFOX177374549729693',link_status:'linked'},
  'H2-039':{event_type:'READY_FOR_PICKUP',perspective:'buyer',order_id:null,tracking_id:'Z3818437810',link_status:'unresolved'},
  'H2-050':{event_type:'SHIPPED',perspective:'buyer',order_id:'1000579442',tracking_id:'03216953737',link_status:'linked'},
  'H2-061':{event_type:'INVOICE',perspective:'buyer',order_id:'PE7944842',tracking_id:null,link_status:'linked'},
  'H2-064':{event_type:'OTHER',perspective:'non_purchase',order_id:null,tracking_id:null,link_status:'not_applicable'},
  'H2-066':{event_type:'SHIPPED',perspective:'buyer',order_id:null,tracking_id:'Z3818437810',link_status:'unresolved'},
  'H2-073':{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:'15709862007',tracking_id:null,link_status:'linked'},
  'H2-079':{event_type:'OTHER',perspective:'non_purchase',order_id:null,tracking_id:null,link_status:'not_applicable'},
  'H2-088':{event_type:'IN_TRANSIT',perspective:'buyer',order_id:null,tracking_id:'CLFOX178877213432779',link_status:'unresolved'},
  'H2-091':{event_type:'SHIPMENT_CREATED',perspective:'buyer',order_id:'2026/8420/002',tracking_id:'3396347262',link_status:'linked'},
  'H2-094':{event_type:'SHIPPED',perspective:'buyer',order_id:'PBTRE216716300015231013838',tracking_id:'PBTRE216716300015231013838',link_status:'linked'},
  'H2-095':{event_type:'SHIPPED',perspective:'buyer',order_id:null,tracking_id:'PN9S650238675',link_status:'unresolved'}
};

const SYSTEM=`Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts and do not explain the answer.
Allowed event_type: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
Allowed perspective: buyer, merchant_outbound, non_purchase.
Allowed link_status: linked, unresolved, not_applicable.

Follow this decision order strictly:
1. SCOPE / PERSPECTIVE.
2. CURRENT state that is already true now.
3. Explicit buyer-side IDs and their roles.
4. link_status.
5. Final consistency check.

SCOPE / PERSPECTIVE:
- buyer = mailbox owner is the customer or recipient side.
- merchant_outbound = mailbox owner is acting as seller/shipper and the message concerns pickup, fulfillment, or delivery FROM the mailbox owner toward the mailbox owner's customers.
- non_purchase = survey, review request, marketing, security, preference, account-admin, or other non-purchase content.
- A carrier collecting a parcel FROM the mailbox owner/sender is merchant_outbound, never buyer delivery.
- A survey/review-request email is non_purchase even if it quotes a prior order, shipment, tracking number, or delivered event as context. Do not turn survey/review context into a lifecycle event.
- If perspective = non_purchase: event_type MUST be OTHER; order_id MUST be null; tracking_id MUST be null; link_status MUST be not_applicable.
- If perspective = merchant_outbound: order_id MUST be null; tracking_id MUST be null; link_status MUST be not_applicable. Pickup-job IDs, collection-request IDs and booking references are not buyer IDs.

CURRENT STATE — only what is already true:
- ORDER_CREATED = buyer order received/accepted, no later processing state.
- ORDER_PROCESSING = buyer order is being prepared/processed and there is no shipment/pre-advice state yet.
- SHIPMENT_CREATED = shipment/tracking/pre-advice exists, or parcel is packed and waiting for carrier; physical carrier handoff has NOT yet happened.
- SHIPPED = sender/warehouse explicitly says the parcel was physically handed to / collected by the carrier, and no later carrier-network movement is the current state.
- IN_TRANSIT = parcel is physically inside carrier transport/network and moving or being processed between carrier facilities.
- OUT_FOR_DELIVERY = parcel is assigned to today's final-mile courier/vehicle for recipient delivery.
- READY_FOR_PICKUP = parcel is physically at locker/pickup point and available to recipient.
- DELIVERED = recipient handoff completed.
- REFUNDED = money was actually returned/completed.
- RETURN = returned parcel physically received by merchant/returns warehouse.
- A future or planned event is NOT current. Words equivalent to 'will hand over', 'will be collected', 'soon goes to carrier', 'waiting for courier' do not prove SHIPPED.
- If a parcel was collected from a drop-off/parcel locker and the email says it is now on the way to the carrier's warehouse/depot for processing, classify IN_TRANSIT, not SHIPPED. The parcel is already moving inside the carrier network.
- If the carrier says the parcel was physically inbounded/received at its central warehouse and is being processed there, classify IN_TRANSIT.
- Prefer the newest directly asserted state over older history, headings, progress bars, generic labels or future ETA text.

ID ROLE RULES:
- Extract order_id only when explicitly identified as buyer order number/order ID.
- Extract tracking_id only when explicitly identified as shipment/tracking/parcel/waybill ID or clearly used by the carrier tracking link.
- Ignore invoice numbers, transaction IDs, authorization codes, product/SKU IDs, coupon codes, generic references and document numbers unless explicitly labeled as buyer order/tracking ID.
- If the exact same literal is explicitly labeled both as order number and shipment/tracking ID, it may legitimately populate both fields.
- Do not invent missing IDs.

LINKING:
- linked = exact buyer order ID exists for this event, OR the email explicitly relates an exact buyer order ID to its tracking/shipment ID.
- unresolved = buyer lifecycle event exists but no exact buyer purchase link is available, or only a tracking ID is available.
- not_applicable = merchant_outbound or non_purchase. For perspective=buyer, if order_id or tracking_id is present, do not use not_applicable.

FINAL CONSISTENCY CHECK BEFORE OUTPUT:
- survey/review => OTHER + non_purchase + null IDs + not_applicable.
- merchant_outbound => null IDs + not_applicable.
- packed/waiting/future handoff => not SHIPPED.
- collected and now moving to carrier warehouse/depot => IN_TRANSIT.
- buyer + only tracking ID => unresolved.
- verify order_id and tracking_id roles one last time.`;

const SCHEMA={type:'object',properties:{event_type:{type:'string',enum:EVENTS},perspective:{type:'string',enum:PERSPECTIVES},order_id:{type:['string','null']},tracking_id:{type:['string','null']},link_status:{type:'string',enum:LINKS}},required:FIELDS,additionalProperties:false};

function extractOutputText(d){if(typeof d?.output_text==='string'&&d.output_text.trim())return d.output_text.trim();const parts=[];for(const item of d?.output??[])if(item?.type==='message')for(const c of item?.content??[])if(c?.type==='output_text'&&typeof c.text==='string')parts.push(c.text);return parts.join('').trim();}
function canonicalizeTracking(v){if(typeof v!=='string')return v??null;const s=v.trim();if(/^Z\s*\d{3}\s*\d{4}\s*\d{3}$/i.test(s))return s.replace(/\s+/g,'');return s;}
function enforcePrediction(v){if(!v||typeof v!=='object')throw new Error('OUTPUT_NOT_OBJECT');const p={event_type:v.event_type,perspective:v.perspective,order_id:v.order_id??null,tracking_id:canonicalizeTracking(v.tracking_id),link_status:v.link_status};if(!EVENTS.includes(p.event_type))throw new Error('BAD_EVENT_TYPE');if(!PERSPECTIVES.includes(p.perspective))throw new Error('BAD_PERSPECTIVE');if(!LINKS.includes(p.link_status))throw new Error('BAD_LINK_STATUS');if(p.perspective==='non_purchase'){p.event_type='OTHER';p.order_id=null;p.tracking_id=null;p.link_status='not_applicable';}else if(p.perspective==='merchant_outbound'){p.order_id=null;p.tracking_id=null;p.link_status='not_applicable';}else if(p.perspective==='buyer'&&(p.order_id!==null||p.tracking_id!==null)&&p.link_status==='not_applicable'){p.link_status='unresolved';}return p;}
function same(a,b){return FIELDS.every(f=>a?.[f]===b?.[f]);}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function callModel(apiKey,emailText){const retry=[1000,2500,6000];for(let attempt=0;;attempt++){const res=await fetch(API_URL,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,instructions:SYSTEM,input:`Email:\n\n${emailText}`,reasoning:{effort:'low'},text:{verbosity:'low',format:{type:'json_schema',name:'buyflow_email_classification_v3',strict:true,schema:SCHEMA}},max_output_tokens:512,store:false})});if(res.ok){const data=await res.json();const text=extractOutputText(data);if(!text)throw new Error('OPENAI_NO_OUTPUT');return{prediction:enforcePrediction(JSON.parse(text)),usage:data.usage??{},resolved:data.model??MODEL};}const detail=await res.text().catch(()=>'');if([408,429,500,502,503,504].includes(res.status)&&attempt<retry.length){await sleep(retry[attempt]);continue;}throw new Error(`OPENAI_HTTP_${res.status}:${detail.slice(0,250)}`);}}

async function main(){
  const bundlePath=process.argv[2];
  const outPath=process.argv[3]||path.join(path.dirname(bundlePath),'real100-h2-prompt-v3-luna-diagnostic14.json');
  const apiKey=process.env.OPENAI_API_KEY?.trim();
  if(!bundlePath)throw new Error('USAGE: <h2-bundle.json> [out.json]');
  if(!apiKey)throw new Error('OPENAI_API_KEY_MISSING');
  const bundle=JSON.parse(await readFile(bundlePath,'utf8'));
  if(bundle?.benchmark!==EXPECTED_BENCHMARK)throw new Error('BUNDLE_BENCHMARK_INVALID');
  if(bundle?.selection_sha256!==EXPECTED_SELECTION_SHA)throw new Error('BUNDLE_SELECTION_SHA_INVALID');
  if(!Array.isArray(bundle?.cases)||bundle.cases.length!==100)throw new Error('BUNDLE_CASES_INVALID');
  for(const c of bundle.cases){if(c?.mail_lens_normalizer!==EXPECTED_NORMALIZER)throw new Error(`BUNDLE_NORMALIZER_INVALID:${c?.case_id}`);}
  const byId=new Map(bundle.cases.map(c=>[c.case_id,c]));
  for(const id of TARGETS)if(!byId.has(id))throw new Error(`TARGET_NOT_FOUND:${id}`);

  console.log('==============================================================');
  console.log('BUYFLOW H2 SPENT-DATA DIAGNOSTIC - LUNA PROMPT V3');
  console.log('14 targeted real emails | MailLens v1.1 | Luna only');
  console.log('H2 is now tuning/diagnostic data, NOT a clean final holdout.');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  const usage={input_tokens:0,output_tokens:0,reasoning_tokens:0};
  const rows=[];let exact=0;let errors=0;
  for(let i=0;i<TARGETS.length;i++){
    const id=TARGETS[i],c=byId.get(id);
    const emailText=`Feladó: ${c.from??''}\nTárgy: ${c.subject??''}\n\n${c.semantic_text??''}`;
    try{
      const r=await callModel(apiKey,emailText);
      usage.input_tokens+=Number(r.usage?.input_tokens??0);
      usage.output_tokens+=Number(r.usage?.output_tokens??0);
      usage.reasoning_tokens+=Number(r.usage?.output_tokens_details?.reasoning_tokens??0);
      const ok=same(r.prediction,EXPECTED[id]);if(ok)exact++;
      rows.push({case_id:id,prediction:r.prediction,expected:EXPECTED[id],exact:ok,error:null});
      console.log(`[${String(i+1).padStart(2,'0')}/${TARGETS.length}] ${id} ${ok?'PASS':'FAIL'} | ${JSON.stringify(r.prediction)}`);
    }catch(e){errors++;const msg=e instanceof Error?e.message:String(e);rows.push({case_id:id,prediction:null,expected:EXPECTED[id],exact:false,error:msg});console.log(`[${String(i+1).padStart(2,'0')}/${TARGETS.length}] ${id} ERROR ${msg}`);}
  }
  const summary={benchmark:'buyflow-h2-spent-prompt-v3-luna-diagnostic14',created_at:new Date().toISOString(),model:MODEL,prompt_version:'merchant-outbound-linking-v3',mail_lens_normalizer:EXPECTED_NORMALIZER,selection_sha256:bundle.selection_sha256,total:TARGETS.length,exact,exact_pct:Number((exact/TARGETS.length*100).toFixed(1)),technical_errors:errors,usage,safety:{gmail_calls:0,buyflow_writes:0,production_off:true,blind_o3_used:false,openai_store:false},warning:'H2 has been inspected and is tuning/diagnostic data; do not report this as blind production accuracy.',rows};
  await writeFile(outPath,JSON.stringify(summary,null,2)+'\n','utf8');
  console.log('');
  console.log(`V3 diagnostic exact: ${exact}/${TARGETS.length} = ${summary.exact_pct}%`);
  console.log(`Technical errors: ${errors}`);
  console.log(`Tokens: in=${usage.input_tokens} out=${usage.output_tokens} reasoning=${usage.reasoning_tokens}`);
  console.log(`Result: ${outPath}`);
  console.log('==============================================================');
}

main().catch(e=>{console.error(`H2_V3_DIAGNOSTIC_FATAL: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
