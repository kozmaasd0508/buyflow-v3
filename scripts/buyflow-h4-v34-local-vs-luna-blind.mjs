import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const OLLAMA_URL = process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434';
const LOCAL_MODEL = process.env.BUYFLOW_LOCAL_MODEL?.trim() || 'gpt-oss:20b';
const LUNA_MODEL = 'gpt-5.6-luna';

const EVENTS = ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','DELAYED','CANCELLED','REFUNDED','RETURN','OTHER'];
const PERSPECTIVES = ['buyer','merchant_outbound','non_purchase'];
const LINKS = ['linked','unresolved','not_applicable'];
const FIELDS = ['event_type','perspective','order_id','tracking_id','link_status'];

const EXPECTED_BENCHMARK = 'buyflow-real100-h4-blind-maillens-v1.2';
const EXPECTED_GOLD = 'buyflow-real100-h4-gold-v1-pre-model';
const EXPECTED_SELECTION_SHA = 'ab0104762feaf0b1c05e871a92321060f97eb20bd9edbf6cdf1d3aa1c525caa9';
const EXPECTED_NORMALIZER = 'normalized-email-document-v1.2';
const EXPECTED_MAILLENS_COMMIT = 'a10c6a61036e91e91dfbad3eaa998e81f6239401';
const EXPECTED_POLICY_COMMIT = 'bc046c361a9269e891456bc0b8e7105c701cf59e';
const EXPECTED_PROMPT_COMMIT = '25810f66af0855fbc81d913872072d42d75a0abb';
const EXPECTED_GOLD_COMMIT = '385aa15d1978fa1941bf3a962fcb9095da44d657';

const SCHEMA = {
  type: 'object',
  properties: {
    event_type: { type: 'string', enum: EVENTS },
    perspective: { type: 'string', enum: PERSPECTIVES },
    order_id: { type: ['string','null'] },
    tracking_id: { type: ['string','null'] },
    link_status: { type: 'string', enum: LINKS }
  },
  required: FIELDS,
  additionalProperties: false
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function canonicalizeTracking(v) {
  if (typeof v !== 'string') return v ?? null;
  const s = v.trim();
  if (/^Z\s*\d{3}\s*\d{4}\s*\d{3}$/i.test(s)) return s.replace(/\s+/g, '');
  return s;
}

function enforcePrediction(v) {
  if (!v || typeof v !== 'object') throw new Error('OUTPUT_NOT_OBJECT');
  const p = {
    event_type: v.event_type,
    perspective: v.perspective,
    order_id: typeof v.order_id === 'string' ? v.order_id.trim() : null,
    tracking_id: canonicalizeTracking(v.tracking_id),
    link_status: v.link_status
  };
  if (!EVENTS.includes(p.event_type)) throw new Error('BAD_EVENT_TYPE');
  if (!PERSPECTIVES.includes(p.perspective)) throw new Error('BAD_PERSPECTIVE');
  if (!LINKS.includes(p.link_status)) throw new Error('BAD_LINK_STATUS');
  if (p.order_id === '') p.order_id = null;
  if (p.tracking_id === '') p.tracking_id = null;
  if (p.perspective === 'non_purchase') {
    p.event_type = 'OTHER';
    p.order_id = null;
    p.tracking_id = null;
    p.link_status = 'not_applicable';
  } else if (p.perspective === 'merchant_outbound') {
    p.order_id = null;
    p.tracking_id = null;
    p.link_status = 'not_applicable';
  } else if (p.perspective === 'buyer' && (p.order_id !== null || p.tracking_id !== null) && p.link_status === 'not_applicable') {
    p.link_status = 'unresolved';
  }
  return p;
}

function deterministicInputGate(c) {
  const t = String(c?.semantic_text ?? '').replace(/\s+/g,' ').trim();
  if (!t) return 'REVIEW_INPUT_INCOMPLETE';
  if (t.length <= 260 && /html email/i.test(t) && /(does not support|cannot display|can't display|properly view)/i.test(t)) {
    return 'REVIEW_INPUT_INCOMPLETE';
  }
  return null;
}

function extractOpenAIText(d) {
  if (typeof d?.output_text === 'string' && d.output_text.trim()) return d.output_text.trim();
  const parts = [];
  for (const item of d?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item?.content ?? []) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('').trim();
}

async function verifyLocalModel() {
  const r = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!r.ok) throw new Error(`OLLAMA_TAGS_HTTP_${r.status}`);
  const d = await r.json();
  const names = (d?.models ?? []).map(x => x?.name).filter(Boolean);
  if (!names.includes(LOCAL_MODEL)) throw new Error(`LOCAL_MODEL_NOT_FOUND:${LOCAL_MODEL};available=${names.join(',')}`);
  return names;
}

async function callLocal(systemPrompt, emailText) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LOCAL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Email:\n\n${emailText}` }
      ],
      format: SCHEMA,
      stream: false,
      options: { temperature: 0, num_ctx: 8192, num_predict: 512 },
      keep_alive: '10m'
    })
  });
  if (!r.ok) throw new Error(`OLLAMA_HTTP_${r.status}:${(await r.text()).slice(0,240)}`);
  const d = await r.json();
  const text = d?.message?.content?.trim();
  if (!text) throw new Error('OLLAMA_NO_OUTPUT');
  return {
    prediction: enforcePrediction(JSON.parse(text)),
    usage: {
      prompt_eval_count: Number(d?.prompt_eval_count ?? 0),
      eval_count: Number(d?.eval_count ?? 0),
      total_duration_ns: Number(d?.total_duration ?? 0)
    }
  };
}

async function callLuna(apiKey, systemPrompt, emailText) {
  const retry = [1000, 2500, 6000];
  for (let attempt = 0;; attempt++) {
    const r = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LUNA_MODEL,
        instructions: systemPrompt,
        input: `Email:\n\n${emailText}`,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low', format: { type: 'json_schema', name: 'buyflow_h4_v34', strict: true, schema: SCHEMA } },
        max_output_tokens: 512,
        store: false
      })
    });
    if (r.ok) {
      const d = await r.json();
      const text = extractOpenAIText(d);
      if (!text) throw new Error('OPENAI_NO_OUTPUT');
      return {
        prediction: enforcePrediction(JSON.parse(text)),
        usage: {
          input_tokens: Number(d?.usage?.input_tokens ?? 0),
          output_tokens: Number(d?.usage?.output_tokens ?? 0),
          reasoning_tokens: Number(d?.usage?.output_tokens_details?.reasoning_tokens ?? 0)
        }
      };
    }
    const detail = await r.text().catch(() => '');
    if ([408,429,500,502,503,504].includes(r.status) && attempt < retry.length) {
      await sleep(retry[attempt]);
      continue;
    }
    throw new Error(`OPENAI_HTTP_${r.status}:${detail.slice(0,240)}`);
  }
}

function validate(bundle, gold, prompt) {
  if (bundle?.benchmark !== EXPECTED_BENCHMARK) throw new Error('BUNDLE_BENCHMARK_INVALID');
  if (bundle?.selection_sha256 !== EXPECTED_SELECTION_SHA) throw new Error('SELECTION_SHA_INVALID');
  if (bundle?.mail_lens_normalizer !== EXPECTED_NORMALIZER) throw new Error('NORMALIZER_INVALID');
  if (bundle?.mail_lens_pinned_commit !== EXPECTED_MAILLENS_COMMIT) throw new Error('MAILLENS_COMMIT_INVALID');
  if (bundle?.policy_v34_frozen_commit !== EXPECTED_POLICY_COMMIT) throw new Error('POLICY_COMMIT_INVALID');
  if (bundle?.prompt_v34_frozen_commit !== EXPECTED_PROMPT_COMMIT) throw new Error('PROMPT_COMMIT_INVALID');
  if (!Array.isArray(bundle?.cases) || bundle.cases.length !== 100) throw new Error('BUNDLE_CASE_COUNT_INVALID');
  if (bundle?.gold_labels_included !== false) throw new Error('BUNDLE_GOLD_LEAK');

  if (gold?.benchmark !== EXPECTED_GOLD) throw new Error('GOLD_BENCHMARK_INVALID');
  if (gold?.selection_sha256 !== EXPECTED_SELECTION_SHA) throw new Error('GOLD_SELECTION_SHA_INVALID');
  if (gold?.policy_frozen_commit !== EXPECTED_POLICY_COMMIT) throw new Error('GOLD_POLICY_COMMIT_INVALID');
  if (gold?.prompt_frozen_commit !== EXPECTED_PROMPT_COMMIT) throw new Error('GOLD_PROMPT_COMMIT_INVALID');
  if (gold?.gold_count !== 96 || gold?.review_count !== 4 || !Array.isArray(gold?.cases) || gold.cases.length !== 100) throw new Error('GOLD_COUNTS_INVALID');
  if (gold?.adjudication?.local_ai_predictions_seen !== false || gold?.adjudication?.luna_predictions_seen !== false) throw new Error('GOLD_NOT_PRE_MODEL');
  if (/H4-\d{3}/.test(prompt)) throw new Error('PROMPT_CASE_ID_LEAK');
  if (!prompt.includes('DELAYED') || !prompt.includes('merchant-outbound pickup/collection')) throw new Error('PROMPT_CONTENT_INVALID');

  const ids = bundle.cases.map(c => c.case_id);
  if (new Set(ids).size !== 100) throw new Error('BUNDLE_DUPLICATE_CASE_ID');
  const gids = gold.cases.map(c => c.case_id);
  if (new Set(gids).size !== 100 || ids.some((id,i) => id !== gids[i])) throw new Error('GOLD_CASE_ORDER_MISMATCH');
}

async function freezePredictions(kind, bundle, systemPrompt, apiKey, outPath) {
  const rows = [];
  const usage = kind === 'local'
    ? { prompt_eval_count: 0, eval_count: 0, total_duration_ns: 0 }
    : { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let calls = 0, gated = 0, errors = 0;

  console.log(`\n[${kind}] freezing predictions; no scoring yet...`);
  for (let i = 0; i < bundle.cases.length; i++) {
    const c = bundle.cases[i];
    const gate = deterministicInputGate(c);
    if (gate) {
      gated++;
      rows.push({ case_id: c.case_id, route: 'review_input_incomplete', gate, model_called: false, prediction: null, error: null });
      console.log(`[${kind} ${String(i+1).padStart(3,'0')}/100] GATED`);
      continue;
    }
    const emailText = `Feladó: ${c.from ?? ''}\nTárgy: ${c.subject ?? ''}\n\n${c.semantic_text ?? ''}`;
    try {
      calls++;
      const r = kind === 'local'
        ? await callLocal(systemPrompt, emailText)
        : await callLuna(apiKey, systemPrompt, emailText);
      for (const k of Object.keys(usage)) usage[k] += Number(r.usage?.[k] ?? 0);
      rows.push({ case_id: c.case_id, route: 'model', gate: null, model_called: true, prediction: r.prediction, error: null });
      console.log(`[${kind} ${String(i+1).padStart(3,'0')}/100] OK`);
    } catch (e) {
      errors++;
      rows.push({ case_id: c.case_id, route: 'model', gate: null, model_called: true, prediction: null, error: e instanceof Error ? e.message : String(e) });
      console.log(`[${kind} ${String(i+1).padStart(3,'0')}/100] ERROR`);
    }
  }
  const artifact = {
    benchmark: `buyflow-real100-h4-v34-${kind}-predictions`,
    created_at: new Date().toISOString(),
    selection_sha256: bundle.selection_sha256,
    prompt_commit: EXPECTED_PROMPT_COMMIT,
    policy_commit: EXPECTED_POLICY_COMMIT,
    gold_commit: EXPECTED_GOLD_COMMIT,
    model: kind === 'local' ? LOCAL_MODEL : LUNA_MODEL,
    total: 100,
    model_calls: calls,
    deterministic_input_gate_reviews: gated,
    technical_errors: errors,
    usage,
    safety: { gmail_calls: 0, buyflow_writes: 0, lifecycle_writes: 0, production_off: true, blind_o3_used: false, openai_store: kind === 'luna' ? false : null },
    rows
  };
  await writeFile(outPath, JSON.stringify(artifact, null, 2) + '\n');
  return artifact;
}

function scoreOne(artifact, gold) {
  const byId = new Map(artifact.rows.map(r => [r.case_id, r]));
  let exact = 0;
  const fields = Object.fromEntries(FIELDS.map(f => [f,0]));
  const goldRows = [];
  const reviewRows = [];
  for (const g of gold.cases) {
    const r = byId.get(g.case_id);
    if (!r) throw new Error(`PREDICTION_MISSING:${artifact.model}:${g.case_id}`);
    if (g.status === 'review') {
      reviewRows.push({ case_id: g.case_id, prediction: r.prediction, route: r.route, error: r.error, review_note: g.note });
      continue;
    }
    const p = r.prediction;
    const fieldOk = Object.fromEntries(FIELDS.map(f => [f, p?.[f] === g[f]]));
    for (const f of FIELDS) if (fieldOk[f]) fields[f]++;
    const ok = FIELDS.every(f => fieldOk[f]);
    if (ok) exact++;
    goldRows.push({ case_id: g.case_id, prediction: p, expected: Object.fromEntries(FIELDS.map(f => [f,g[f]])), exact: ok, field_exact: fieldOk, error: r.error });
  }
  return {
    model: artifact.model,
    goldable: gold.gold_count,
    review: gold.review_count,
    exact,
    exact_pct: Number((100 * exact / gold.gold_count).toFixed(1)),
    field_exact: Object.fromEntries(FIELDS.map(f => [f, { exact: fields[f], total: gold.gold_count, pct: Number((100 * fields[f] / gold.gold_count).toFixed(1)) }])),
    technical_errors: artifact.technical_errors,
    model_calls: artifact.model_calls,
    deterministic_input_gate_reviews: artifact.deterministic_input_gate_reviews,
    usage: artifact.usage,
    gold_rows: goldRows,
    review_rows: reviewRows
  };
}

async function main() {
  const [bundlePath, goldPath, promptPath, outDirArg] = process.argv.slice(2);
  if (!bundlePath || !goldPath || !promptPath) throw new Error('USAGE: <h4-bundle.json> <h4-gold.json> <prompt-v34.txt> [out-dir]');
  const outDir = path.resolve(outDirArg || path.dirname(bundlePath));
  const bundle = JSON.parse(await readFile(bundlePath,'utf8'));
  const gold = JSON.parse(await readFile(goldPath,'utf8'));
  const systemPrompt = (await readFile(promptPath,'utf8')).trim();
  validate(bundle, gold, systemPrompt);
  await verifyLocalModel();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

  console.log('================================================================');
  console.log('BUYFLOW H4 FRESH BLIND — LOCAL AI vs LUNA — V3.4');
  console.log(`Selection SHA: ${EXPECTED_SELECTION_SHA}`);
  console.log(`Gold: 96 | REVIEW: 4 | Local: ${LOCAL_MODEL} | Luna: ${LUNA_MODEL}`);
  console.log('Predictions are frozen for BOTH models before scoring is revealed.');
  console.log('Production OFF | Gmail 0 | BuyFlow writes 0 | O3 NOT USED');
  console.log('================================================================');

  const localPath = path.join(outDir,'real100-h4-v34-local-predictions.json');
  const lunaPath = path.join(outDir,'real100-h4-v34-luna-predictions.json');
  const resultPath = path.join(outDir,'real100-h4-v34-local-vs-luna-blind-result.json');

  const local = await freezePredictions('local', bundle, systemPrompt, apiKey, localPath);
  const luna = await freezePredictions('luna', bundle, systemPrompt, apiKey, lunaPath);

  const result = {
    benchmark: 'buyflow-real100-h4-v34-local-vs-luna-fresh-blind',
    created_at: new Date().toISOString(),
    selection_sha256: EXPECTED_SELECTION_SHA,
    mail_lens_normalizer: EXPECTED_NORMALIZER,
    mail_lens_commit: EXPECTED_MAILLENS_COMMIT,
    policy_commit: EXPECTED_POLICY_COMMIT,
    prompt_commit: EXPECTED_PROMPT_COMMIT,
    gold_commit: EXPECTED_GOLD_COMMIT,
    goldable: gold.gold_count,
    review: gold.review_count,
    local: scoreOne(local,gold),
    luna: scoreOne(luna,gold),
    safety: { gmail_calls: 0, buyflow_writes: 0, lifecycle_writes: 0, production_off: true, blind_o3_used: false, openai_store: false },
    warning: 'H4 is fresh blind only until these model outputs are inspected. After this result is revealed H4 is spent.'
  };
  await writeFile(resultPath, JSON.stringify(result,null,2)+'\n');

  console.log('\n================ H4 COMPARISON EVIDENCE RECEIPT ================');
  console.log(JSON.stringify({
    evidence_receipt: 'PASS',
    benchmark: result.benchmark,
    selection_sha256: result.selection_sha256,
    goldable: result.goldable,
    review: result.review,
    local_model: result.local.model,
    local_exact: `${result.local.exact}/${result.local.goldable}`,
    local_exact_pct: result.local.exact_pct,
    local_technical_errors: result.local.technical_errors,
    luna_model: result.luna.model,
    luna_exact: `${result.luna.exact}/${result.luna.goldable}`,
    luna_exact_pct: result.luna.exact_pct,
    luna_technical_errors: result.luna.technical_errors,
    deterministic_input_gate_reviews_local: result.local.deterministic_input_gate_reviews,
    deterministic_input_gate_reviews_luna: result.luna.deterministic_input_gate_reviews,
    gmail_calls: 0,
    buyflow_writes: 0,
    lifecycle_writes: 0,
    production_off: true,
    o3_used: false,
    local_predictions: localPath,
    luna_predictions: lunaPath,
    result: resultPath
  }, null, 2));
  console.log('================================================================');
}

main().catch(e => {
  console.error(`H4_COMPARE_FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
