import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const DIR = process.argv[2] || path.join(os.homedir(), 'Desktop', 'buyflow-v17-external-blind');
const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.BUYFLOW_CHAT_MODEL || 'gemma3:12b';
const EXPECTED_INPUT_SHA = '17ceb35d7f91f8a626a9e043a220c6b06cbf194de5ed9d37f2518b6babf7286f';
const EXPECTED_GOLD_SHA = '382c29a56dfe94298df0dbcc751738fbaaf9a65a8fc9fc314a544c2bf6034eb3';

const SYSTEM = `You are a helpful assistant analyzing commerce emails for BuyFlow.
Understand each email from its actual meaning and evidence. Do not invent missing facts or links.
Use these event labels when they fit: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
If the text clearly says the seller handed the parcel to the carrier, classify it as SHIPPED rather than SHIPMENT_CREATED.
merchant_outbound means the mailbox owner is acting as the sender/seller and a carrier is collecting or transporting parcels the mailbox owner is sending to customers. Do not mark ordinary incoming buyer purchase emails as merchant_outbound just because the sender is a merchant, carrier, payment provider or invoicing service.
Link emails only when the text gives reliable evidence such as an exact order ID or exact tracking ID. If the link is uncertain, say so.
Keep the final summary consistent with the per-email classifications already given; do not reassign an email to a different purchase or event without explicit new evidence.
Answer in the user's language.`;

const inputFile = path.join(DIR, 'blind-input.jsonl');
const goldFile = path.join(DIR, 'blind-gold.jsonl');
if (!fs.existsSync(inputFile) || !fs.existsSync(goldFile)) {
  throw new Error(`External blind files missing in ${DIR}`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const inputBuf = fs.readFileSync(inputFile);
const goldBuf = fs.readFileSync(goldFile);
const inputSha = sha256(inputBuf);
const goldSha = sha256(goldBuf);
if (inputSha !== EXPECTED_INPUT_SHA) throw new Error(`blind-input hash mismatch: ${inputSha}`);
if (goldSha !== EXPECTED_GOLD_SHA) throw new Error(`blind-gold hash mismatch: ${goldSha}`);

const parseJsonl = (buf) => buf.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const inputs = parseJsonl(inputBuf);
if (inputs.length !== 30) throw new Error(`Expected 30 blind inputs, got ${inputs.length}`);

async function health() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const j = await r.json();
  const names = (j.models || []).map(x => x.name || x.model);
  if (!names.some(x => x === MODEL || x?.startsWith(`${MODEL}:`))) {
    throw new Error(`Model not found: ${MODEL}. Installed: ${names.join(', ')}`);
  }
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }
  throw new Error('invalid_json');
}

function normalize(v) {
  return {
    event_type: v?.event_type ?? null,
    perspective: v?.perspective ?? null,
    order_id: v?.order_id ?? null,
    tracking_id: v?.tracking_id ?? null,
    link_status: v?.link_status ?? null
  };
}

async function classify(row) {
  const user = `Elemezd ezt az e-mailt BuyFlow szerint. Csak egy JSON objektumot adj vissza, magyarázó szöveg nélkül, pontosan ezekkel a mezőkkel: event_type, perspective, order_id, tracking_id, link_status. Ha egy azonosító nem bizonyítható, legyen null.\n\n${row.input}`;
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({
      model: MODEL,
      messages: [{role:'system',content:SYSTEM},{role:'user',content:user}],
      stream: false,
      options: {temperature: 0, num_ctx: 8192, seed: 17012026}
    })
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const raw = j?.message?.content ?? '';
  return {raw, pred: normalize(extractJson(raw))};
}

await health();
console.log('==============================================================');
console.log('BUYFLOW V17.1 EXTERNAL BLIND BASELINE');
console.log(`Model: ${MODEL}`);
console.log('Cases: 30');
console.log(`Input SHA: ${inputSha}`);
console.log(`Gold SHA:  ${goldSha}`);
console.log('Gmail 0 | BuyFlow writes 0 | Production OFF');
console.log('Gold is NOT sent to the model.');
console.log('==============================================================');

const predictions = [];
let modelErrors = 0;
for (let i = 0; i < inputs.length; i++) {
  const row = inputs[i];
  process.stdout.write(`[${String(i+1).padStart(2,'0')}/30] ${row.id} ... `);
  try {
    const {raw,pred} = await classify(row);
    predictions.push({id:row.id,pred,raw});
    console.log(`${pred.event_type} | ${pred.perspective} | ${pred.link_status}`);
  } catch (e) {
    modelErrors++;
    predictions.push({id:row.id,pred:null,raw:null,error:e.message});
    console.log(`ERROR: ${e.message}`);
  }
}

// Only now, after all model calls are complete, parse the gold labels for scoring.
const goldRows = parseJsonl(goldBuf);
const goldById = new Map(goldRows.map(x => [x.id, normalize(x.gold)]));
const fields = ['event_type','perspective','order_id','tracking_id','link_status'];
const fieldCorrect = Object.fromEntries(fields.map(f => [f,0]));
let exact = 0;
const failures = [];
for (const r of predictions) {
  const gold = goldById.get(r.id);
  const pred = r.pred;
  if (!gold || !pred) {
    failures.push({id:r.id,gold,pred,error:r.error || 'missing'});
    continue;
  }
  let all = true;
  for (const f of fields) {
    const ok = pred[f] === gold[f];
    if (ok) fieldCorrect[f]++;
    else all = false;
  }
  if (all) exact++;
  else failures.push({id:r.id,gold,pred});
}

const report = {
  benchmark: 'buyflow-v17-external-blind-v1',
  runtime: 'v17.1-minimal-prompt-3-fixes',
  model: MODEL,
  cases: inputs.length,
  input_sha256: inputSha,
  gold_sha256: goldSha,
  decoding: {temperature:0,num_ctx:8192,seed:17012026},
  exact: {correct:exact,total:inputs.length,pct:Number((exact/inputs.length*100).toFixed(2))},
  fields: Object.fromEntries(fields.map(f => [f,{correct:fieldCorrect[f],total:inputs.length,pct:Number((fieldCorrect[f]/inputs.length*100).toFixed(2))}])),
  model_errors: modelErrors,
  failures,
  predictions
};
const reportFile = path.join(DIR, 'baseline-v17.1-report.json');
fs.writeFileSync(reportFile, JSON.stringify(report,null,2)+'\n','utf8');

console.log('');
console.log('==================== BASELINE RESULT =========================');
console.log(`EXACT: ${exact}/30 = ${report.exact.pct}%`);
for (const f of fields) console.log(`${f}: ${fieldCorrect[f]}/30 = ${report.fields[f].pct}%`);
console.log(`Errors: ${modelErrors}`);
console.log(`Failures: ${failures.length}`);
if (failures.length) {
  console.log('FAIL CASES:');
  for (const x of failures) {
    if (!x.pred) console.log(`- ${x.id}: ERROR ${x.error}`);
    else console.log(`- ${x.id}: expected ${JSON.stringify(x.gold)} | got ${JSON.stringify(x.pred)}`);
  }
}
console.log(`Report: ${reportFile}`);
console.log('==============================================================');
