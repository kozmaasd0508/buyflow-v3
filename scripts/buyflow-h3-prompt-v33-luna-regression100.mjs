import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5.6-luna';
const EVENTS = ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','DELAYED','CANCELLED','REFUNDED','RETURN','OTHER'];
const PERSPECTIVES = ['buyer','merchant_outbound','non_purchase'];
const LINKS = ['linked','unresolved','not_applicable'];
const FIELDS = ['event_type','perspective','order_id','tracking_id','link_status'];

const EXPECTED_BUNDLE_BENCHMARK = 'buyflow-real100-h3-blind-maillens-v1.1';
const EXPECTED_GOLD_BENCHMARK = 'buyflow-real100-h3-gold-v1-pre-luna';
const EXPECTED_RESOLUTION_BENCHMARK = 'buyflow-real100-h3-review-resolution-v33';
const EXPECTED_SELECTION_SHA = '59650c8dbb687be609361b3e3576a404f9acdba5ea13f71985dcd0dc2451b04f';
const EXPECTED_NORMALIZER = 'normalized-email-document-v1.1';
const BASELINE_PROMPT_COMMIT = '2eacf018ff6c7d2eef306a2449f1e76bb689f249';
const POLICY_COMMIT = '7d65ea51bc9923b9139458f3f2416a78298ec0e9';
const SOURCE_GOLD_COMMIT = 'a5c54940643374803ba344a4014ba44ae183e240';
const RESOLUTION_COMMIT = '101a982449ef100e9f319296056755bf9b6744fb';
const PROMPT_COMMIT = 'ba42c38974537d9994966a34c74f09b24b6aeddd';

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

function extractOutputText(d) {
  if (typeof d?.output_text === 'string' && d.output_text.trim()) return d.output_text.trim();
  const parts = [];
  for (const item of d?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item?.content ?? []) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('').trim();
}

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
    order_id: v.order_id ?? null,
    tracking_id: canonicalizeTracking(v.tracking_id),
    link_status: v.link_status
  };
  if (!EVENTS.includes(p.event_type)) throw new Error('BAD_EVENT_TYPE');
  if (!PERSPECTIVES.includes(p.perspective)) throw new Error('BAD_PERSPECTIVE');
  if (!LINKS.includes(p.link_status)) throw new Error('BAD_LINK_STATUS');
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

function same(a, b) {
  return FIELDS.every(f => a?.[f] === b?.[f]);
}

function deterministicInputGate(c) {
  const t = String(c?.semantic_text ?? '').trim();
  if (!t) return 'REVIEW_INPUT_INCOMPLETE';
  const compact = t.replace(/\s+/g, ' ').trim();
  if (compact.length <= 220 && /html email/i.test(compact) && /(does not support|cannot display|can't display)/i.test(compact)) {
    return 'REVIEW_INPUT_INCOMPLETE';
  }
  return null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callModel(apiKey, emailText, systemPrompt) {
  const retry = [1000, 2500, 6000];
  for (let attempt = 0;; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        instructions: systemPrompt,
        input: `Email:\n\n${emailText}`,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low', format: { type: 'json_schema', name: 'buyflow_email_classification_v33', strict: true, schema: SCHEMA } },
        max_output_tokens: 512,
        store: false
      })
    });
    if (res.ok) {
      const data = await res.json();
      const text = extractOutputText(data);
      if (!text) throw new Error('OPENAI_NO_OUTPUT');
      return { prediction: enforcePrediction(JSON.parse(text)), usage: data.usage ?? {} };
    }
    const detail = await res.text().catch(() => '');
    if ([408,429,500,502,503,504].includes(res.status) && attempt < retry.length) {
      await sleep(retry[attempt]);
      continue;
    }
    throw new Error(`OPENAI_HTTP_${res.status}:${detail.slice(0,250)}`);
  }
}

function validateInputs(bundle, gold, resolution) {
  if (bundle?.benchmark !== EXPECTED_BUNDLE_BENCHMARK) throw new Error('BUNDLE_BENCHMARK_INVALID');
  if (bundle?.selection_sha256 !== EXPECTED_SELECTION_SHA) throw new Error('BUNDLE_SELECTION_SHA_INVALID');
  if (bundle?.mail_lens_normalizer !== EXPECTED_NORMALIZER) throw new Error('BUNDLE_NORMALIZER_INVALID');
  if (!Array.isArray(bundle?.cases) || bundle.cases.length !== 100) throw new Error('BUNDLE_CASES_INVALID');
  for (const c of bundle.cases) if (c?.mail_lens_normalizer !== EXPECTED_NORMALIZER) throw new Error(`CASE_NORMALIZER_INVALID:${c?.case_id}`);

  if (gold?.benchmark !== EXPECTED_GOLD_BENCHMARK) throw new Error('GOLD_BENCHMARK_INVALID');
  if (gold?.selection_sha256 !== EXPECTED_SELECTION_SHA) throw new Error('GOLD_SELECTION_SHA_INVALID');
  if (gold?.mail_lens_normalizer !== EXPECTED_NORMALIZER) throw new Error('GOLD_NORMALIZER_INVALID');
  if (gold?.prompt_frozen_commit !== BASELINE_PROMPT_COMMIT) throw new Error('GOLD_PROMPT_COMMIT_INVALID');
  if (!Array.isArray(gold?.cases) || gold.cases.length !== 100) throw new Error('GOLD_CASES_INVALID');

  if (resolution?.benchmark !== EXPECTED_RESOLUTION_BENCHMARK) throw new Error('RESOLUTION_BENCHMARK_INVALID');
  if (resolution?.selection_sha256 !== EXPECTED_SELECTION_SHA) throw new Error('RESOLUTION_SELECTION_SHA_INVALID');
  if (resolution?.mail_lens_normalizer !== EXPECTED_NORMALIZER) throw new Error('RESOLUTION_NORMALIZER_INVALID');
  if (resolution?.baseline_prompt_commit !== BASELINE_PROMPT_COMMIT) throw new Error('RESOLUTION_BASELINE_COMMIT_INVALID');
  if (resolution?.policy_commit !== POLICY_COMMIT) throw new Error('RESOLUTION_POLICY_COMMIT_INVALID');
  if (resolution?.source_gold_commit !== SOURCE_GOLD_COMMIT) throw new Error('RESOLUTION_GOLD_COMMIT_INVALID');
  if (!Array.isArray(resolution?.cases) || resolution.cases.length !== 11) throw new Error('RESOLUTION_CASES_INVALID');
}

function buildExpected(gold, resolution) {
  const resById = new Map(resolution.cases.map(x => [x.case_id, x]));
  if (resById.size !== 11) throw new Error('RESOLUTION_DUPLICATE_CASE_ID');
  const expected = new Map();
  let originalGold = 0;
  let resolvedReview = 0;
  for (const c of gold.cases) {
    if (expected.has(c.case_id)) throw new Error(`GOLD_DUPLICATE_CASE_ID:${c.case_id}`);
    if (c.status === 'gold') {
      originalGold++;
      expected.set(c.case_id, {
        route: 'model',
        expected: Object.fromEntries(FIELDS.map(f => [f, c[f]])),
        source: 'pre_luna_gold'
      });
    } else if (c.status === 'review') {
      const r = resById.get(c.case_id);
      if (!r) throw new Error(`REVIEW_RESOLUTION_MISSING:${c.case_id}`);
      expected.set(c.case_id, { ...r, source: 'post_blind_resolution' });
      resolvedReview++;
    } else {
      throw new Error(`GOLD_STATUS_INVALID:${c.case_id}`);
    }
  }
  for (const id of resById.keys()) if (!gold.cases.some(c => c.case_id === id && c.status === 'review')) throw new Error(`RESOLUTION_NOT_REVIEW_CASE:${id}`);
  if (originalGold !== 89 || resolvedReview !== 11 || expected.size !== 100) throw new Error('EXPECTED_SET_COUNT_INVALID');
  return expected;
}

async function main() {
  const bundlePath = process.argv[2];
  const goldPath = process.argv[3];
  const resolutionPath = process.argv[4];
  const promptPath = process.argv[5];
  const outPath = process.argv[6] || path.join(path.dirname(bundlePath || '.'), 'real100-h3-prompt-v33-luna-regression100.json');
  if (!bundlePath || !goldPath || !resolutionPath || !promptPath) throw new Error('USAGE: <h3-bundle.json> <gold-v1.json> <resolution-v33.json> <prompt-v33.txt> [out.json]');

  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  const gold = JSON.parse(await readFile(goldPath, 'utf8'));
  const resolution = JSON.parse(await readFile(resolutionPath, 'utf8'));
  const SYSTEM = (await readFile(promptPath, 'utf8')).trim();
  if (!SYSTEM.includes('Allowed event_type:') || !SYSTEM.includes('DELAYED') || /H3-\d{3}/.test(SYSTEM)) throw new Error('PROMPT_V33_CONTENT_INVALID');
  validateInputs(bundle, gold, resolution);
  const expectedById = buildExpected(gold, resolution);

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

  console.log('==============================================================');
  console.log('BUYFLOW H3 - LUNA PROMPT V3.3 FULL REGRESSION 100');
  console.log('H3 is SPENT after review resolution; this is NOT fresh blind accuracy.');
  console.log('Deterministic input gate runs before model calls.');
  console.log('No Gmail calls | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  const usage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  const rows = [];
  let exact = 0;
  let errors = 0;
  let modelCalls = 0;
  let inputGateReviews = 0;

  for (let i = 0; i < bundle.cases.length; i++) {
    const c = bundle.cases[i];
    const spec = expectedById.get(c.case_id);
    if (!spec) throw new Error(`EXPECTED_CASE_MISSING:${c.case_id}`);
    const gate = deterministicInputGate(c);

    if (gate) {
      inputGateReviews++;
      const ok = spec.route === 'review_input_incomplete' && spec.expected_gate === gate && spec.model_call_allowed === false && spec.lifecycle_write_allowed === false;
      if (ok) exact++;
      rows.push({ case_id: c.case_id, route: 'review_input_incomplete', gate, model_called: false, lifecycle_write_allowed: false, prediction: null, expected: spec, exact: ok, error: null });
      console.log(`[${String(i+1).padStart(3,'0')}/100] ${c.case_id} ${ok ? 'PASS' : 'FAIL'} | GATE ${gate}`);
      continue;
    }

    if (spec.route === 'review_input_incomplete') {
      rows.push({ case_id: c.case_id, route: 'model', gate: null, model_called: false, lifecycle_write_allowed: false, prediction: null, expected: spec, exact: false, error: 'EXPECTED_INPUT_GATE_DID_NOT_TRIGGER' });
      console.log(`[${String(i+1).padStart(3,'0')}/100] ${c.case_id} FAIL | EXPECTED_INPUT_GATE_DID_NOT_TRIGGER`);
      continue;
    }

    const emailText = `Feladó: ${c.from ?? ''}\nTárgy: ${c.subject ?? ''}\n\n${c.semantic_text ?? ''}`;
    try {
      modelCalls++;
      const r = await callModel(apiKey, emailText, SYSTEM);
      usage.input_tokens += Number(r.usage?.input_tokens ?? 0);
      usage.output_tokens += Number(r.usage?.output_tokens ?? 0);
      usage.reasoning_tokens += Number(r.usage?.output_tokens_details?.reasoning_tokens ?? 0);
      const ok = same(r.prediction, spec.expected);
      if (ok) exact++;
      rows.push({ case_id: c.case_id, route: 'model', gate: null, model_called: true, lifecycle_write_allowed: false, prediction: r.prediction, expected: spec.expected, expected_source: spec.source, exact: ok, error: null });
      console.log(`[${String(i+1).padStart(3,'0')}/100] ${c.case_id} ${ok ? 'PASS' : 'FAIL'} | ${JSON.stringify(r.prediction)}`);
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      rows.push({ case_id: c.case_id, route: 'model', gate: null, model_called: true, lifecycle_write_allowed: false, prediction: null, expected: spec.expected, expected_source: spec.source, exact: false, error: msg });
      console.log(`[${String(i+1).padStart(3,'0')}/100] ${c.case_id} ERROR ${msg}`);
    }
  }

  const summary = {
    benchmark: 'buyflow-h3-spent-prompt-v33-luna-regression100',
    created_at: new Date().toISOString(),
    model: MODEL,
    prompt_version: 'merchant-outbound-linking-v3.3',
    baseline_prompt_commit: BASELINE_PROMPT_COMMIT,
    policy_commit: POLICY_COMMIT,
    source_gold_commit: SOURCE_GOLD_COMMIT,
    resolution_commit: RESOLUTION_COMMIT,
    prompt_commit: PROMPT_COMMIT,
    mail_lens_normalizer: EXPECTED_NORMALIZER,
    selection_sha256: bundle.selection_sha256,
    total: 100,
    original_pre_luna_gold: 89,
    post_blind_resolved_reviews: 11,
    exact,
    exact_pct: Number((exact / 100 * 100).toFixed(1)),
    technical_errors: errors,
    model_calls: modelCalls,
    deterministic_input_gate_reviews: inputGateReviews,
    usage,
    safety: {
      gmail_calls: 0,
      buyflow_writes: 0,
      lifecycle_writes: 0,
      production_off: true,
      blind_o3_used: false,
      openai_store: false
    },
    warning: 'H3 is spent/tuning data after review resolution. This is regression evidence only, not fresh blind production accuracy.',
    rows
  };

  await writeFile(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log('');
  console.log(`V3.3 H3 regression exact: ${exact}/100 = ${summary.exact_pct}%`);
  console.log(`Technical errors: ${errors}`);
  console.log(`Model calls: ${modelCalls} | Deterministic input-gate reviews: ${inputGateReviews}`);
  console.log(`Tokens: in=${usage.input_tokens} out=${usage.output_tokens} reasoning=${usage.reasoning_tokens}`);
  console.log(`Result: ${outPath}`);
  console.log('==============================================================');
}

main().catch(e => {
  console.error(`H3_V33_FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
