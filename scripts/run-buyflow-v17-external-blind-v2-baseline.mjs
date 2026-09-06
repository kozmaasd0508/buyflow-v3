import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = process.argv[2] || path.join(os.homedir(),'Desktop','buyflow-v17-external-blind-v2');
const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.BUYFLOW_CHAT_MODEL || 'gemma3:12b';

const SYSTEM = `You are a helpful assistant analyzing commerce emails for BuyFlow.
Understand each email from its actual meaning and evidence. Do not invent missing facts or links.
Use only these event_type values: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
If the text clearly says the seller handed the parcel to the carrier, classify it as SHIPPED rather than SHIPMENT_CREATED.
Use only these perspective values:
- buyer = an incoming message about the mailbox owner's own purchase, payment, invoice, shipment, delivery, cancellation, refund or return;
- merchant_outbound = the mailbox owner is acting as the seller/sender and a carrier is collecting or transporting parcels the mailbox owner sends to customers;
- non_purchase = the message itself is not a purchase lifecycle event, such as marketing, account/security or survey mail.
Use only these link_status values:
- linked = exact evidence or supplied BuyFlow context ties the email to a purchase;
- unresolved = a real commerce/lifecycle event exists but cannot be tied to a purchase with reliable evidence;
- not_applicable = no purchase linking is applicable, such as marketing/security or merchant-outbound operational mail.
If supplied BuyFlow context explicitly maps an order to a tracking ID, preserve that exact order_id and tracking_id and use linked.
Answer only with the requested JSON object.`;

const inputFile=path.join(DIR,'blind-input.jsonl');
const goldFile=path.join(DIR,'blind-gold.jsonl');
const manifestFile=path.join(DIR,'manifest.json');
if(!fs.existsSync(inputFile)||!fs.existsSync(goldFile)||!fs.existsSync(manifestFile)) throw new Error(`V2 blind files missing in ${DIR}`);
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
if(manifest.dataset!=='buyflow-v17-external-blind-v2'||manifest.count!==30) throw new Error('Unexpected external blind manifest');
const parseJsonl=f=>fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const inputs=parseJsonl(inputFile);
if(inputs.length!==30) throw new Error(`Expected 30 inputs, got ${inputs.length}`);

async function health(){
 const r=await fetch(`${OLLAMA}/api/tags`); if(!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
 const j=await r.json(); const names=(j.models||[]).map(x=>x.name||x.model);
 if(!names.some(x=>x===MODEL||x?.startsWith(`${MODEL}:`))) throw new Error(`Model not found: ${MODEL}`);
}
function extractJson(text){
 const t=String(text||'').trim();
 try{return JSON.parse(t);}catch{}
 const f=t.match(/```(?:json)?\s*([\s\S]*?)```/i); if(f){try{return JSON.parse(f[1].trim());}catch{}}
 const a=t.indexOf('{'),b=t.lastIndexOf('}'); if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1));}catch{}}
 throw new Error('invalid_json');
}
function norm(v){return {event_type:v?.event_type??null,perspective:v?.perspective??null,order_id:v?.order_id??null,tracking_id:v?.tracking_id??null,link_status:v?.link_status??null};}
async function classify(row){
 const user=`Elemezd ezt az e-mailt BuyFlow szerint. Csak egy JSON objektumot adj vissza pontosan ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status. Ha order_id vagy tracking_id nem bizonyítható, legyen null.\n\n${row.input}`;
 const r=await fetch(`${OLLAMA}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:MODEL,messages:[{role:'system',content:SYSTEM},{role:'user',content:user}],stream:false,options:{temperature:0,num_ctx:8192,seed:17022026}})});
 if(!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
 const j=await r.json(); return norm(extractJson(j?.message?.content??''));
}

await health();
console.log('==============================================================');
console.log('BUYFLOW V17 EXTERNAL BLIND V2 - PRETRAIN BASELINE');
console.log(`Model: ${MODEL}`);
console.log('Cases: 30 | FROZEN | aggregate-only');
console.log('Gmail 0 | BuyFlow writes 0 | Production OFF');
console.log('Per-case gold/failures will NOT be printed.');
console.log('==============================================================');

const preds=[]; let errors=0;
for(let i=0;i<inputs.length;i++){
 process.stdout.write(`[${String(i+1).padStart(2,'0')}/30] ${inputs[i].id} ... `);
 try{preds.push({id:inputs[i].id,pred:await classify(inputs[i])}); console.log('OK');}
 catch(e){errors++; preds.push({id:inputs[i].id,pred:null}); console.log(`ERROR ${e.message}`);}
}

// Parse gold only after all inference is complete. Never print per-case gold or failures.
const goldRows=parseJsonl(goldFile); const gold=new Map(goldRows.map(x=>[x.id,norm(x.gold)]));
const fields=['event_type','perspective','order_id','tracking_id','link_status'];
const fc=Object.fromEntries(fields.map(f=>[f,0])); let exact=0;
for(const r of preds){const g=gold.get(r.id),p=r.pred;if(!g||!p)continue;let all=true;for(const f of fields){if(p[f]===g[f])fc[f]++;else all=false;}if(all)exact++;}
const pct=n=>Number((n/30*100).toFixed(2));
const summary={benchmark:'buyflow-v17-external-blind-v2',runtime:'v17.1-output-contract-pretrain',model:MODEL,cases:30,exact:{correct:exact,pct:pct(exact)},fields:Object.fromEntries(fields.map(f=>[f,{correct:fc[f],pct:pct(fc[f])}])),errors};
fs.writeFileSync(path.join(DIR,'baseline-v17.1-contract-summary.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log('');
console.log('==================== BASELINE RESULT =========================');
console.log(`EXACT: ${exact}/30 = ${pct(exact)}%`);
for(const f of fields) console.log(`${f}: ${fc[f]}/30 = ${pct(fc[f])}%`);
console.log(`Errors: ${errors}`);
console.log('Gold/failure details: HIDDEN (holdout remains frozen)');
console.log(`Summary: ${path.join(DIR,'baseline-v17.1-contract-summary.json')}`);
console.log('==============================================================');
