#!/usr/bin/env node
import http from 'node:http';
import { createHash } from 'node:crypto';

const BACKEND_MODEL = 'user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg';
const EXPOSED_MODEL_ID = 'gemma3:12b';
const LEMONADE_BASE = 'http://127.0.0.1:13305/v1';
const PORT = Number(process.env.BUYFLOW_GEMMA_V15_LEMONADE_RUNTIME_PORT || '4398');
const CONTEXT_TOKENS = 8192;
const MAX_REQUEST_BYTES = 256_000;
const EXPERIMENT_VERSION = 'eventmind-v15-gate-boundaries-overlay-v1';
const RUNTIME_VERSION = 'eventmind-gemma3-gated-v14-runtime-v1';
const MODEL_DIGEST = createHash('sha256').update(`lemonade:${BACKEND_MODEL}:Q4_K_M`, 'utf8').digest('hex');

const EVENT_TYPES = [
  'ORDER_CREATED', 'ORDER_PROCESSING', 'ORDER_PACKING', 'SHIPMENT_CREATED',
  'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP',
  'DELIVERED', 'DELIVERY_FAILED', 'DELAYED', 'CANCELLED', 'REFUNDED',
  'PAYMENT', 'INVOICE', 'RETURN', 'WARRANTY', 'OTHER',
];

const BUYER_GATE_SCHEMA = {
  type: 'object',
  properties: {
    reason_code: {
      type: 'string',
      enum: [
        'BUYER_PURCHASE', 'BUYER_RETURN', 'MERCHANT_OUTBOUND',
        'MARKETING_SURVEY', 'ACCOUNT_SECURITY', 'OTHER_NON_PURCHASE', 'UNCERTAIN',
      ],
    },
  },
  required: ['reason_code'],
  additionalProperties: false,
};

const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    event_type: { type: 'string', enum: EVENT_TYPES },
  },
  required: ['event_type'],
  additionalProperties: false,
};

const V15_GATE_RULES = `
V15 BUYER-SCOPE DECISION OVERRIDES — apply these before the older instructions below.
Classify the CURRENT MAIN EVENT, not the footer, survey invitation, promotion or secondary call-to-action.
1. If the email explicitly states a current buyer lifecycle event such as order received/confirmed, payment confirmed, invoice issued, parcel shipped/in transit/out for delivery/ready for pickup/delivered, return/refund or warranty, choose BUYER_PURCHASE (or BUYER_RETURN where appropriate) even if the same email later asks for feedback, a rating, a survey, an app install, marketing consent or another promotion. MARKETING_SURVEY is allowed only when there is NO current buyer lifecycle event.
2. DELIVERED plus "rate the delivery", "tell us your opinion", survey, NPS or feedback remains BUYER_PURCHASE. The completed delivery is the main event.
3. ORDER confirmation plus cross-sell, newsletter or promotion remains BUYER_PURCHASE. The order event outranks marketing content.
4. MERCHANT_OUTBOUND requires POSITIVE directional evidence that the mailbox owner is the seller/shipper or that the courier is collecting goods FROM the mailbox owner: e.g. pickup request accepted for goods the mailbox owner sends, courier comes to collect from the sender, merchant fulfillment/admin language. Do NOT infer MERCHANT_OUTBOUND merely because the email is from a courier or contains shipment, parcel, tracking, pickup, dispatch or "feladás" words.
5. Buyer pickup at a locker/store/pickup point is BUYER_PURCHASE; courier pickup FROM the mailbox owner as sender is MERCHANT_OUTBOUND.
6. UNCERTAIN is only for genuinely unresolved direction after checking explicit current-event evidence. If the email clearly describes an incoming buyer lifecycle event, do not choose UNCERTAIN.
Preserve the strict rule that true merchant/outbound operations, pure marketing/surveys, account-security and unrelated mail are not buyer-side.
`;

const V15_EVENT_RULES = `
V15 EVENT-BOUNDARY OVERRIDES — apply these before the older instructions below. Choose the single CURRENT buyer lifecycle state.
A. ORDER_CREATED: order was just placed/received/accepted/confirmed and there is no explicit current preparation stage. Future wording such as "we will prepare/pack/ship" does not upgrade it.
B. ORDER_PROCESSING: seller says the order is currently being processed/prepared/handled, but there is no explicit current packing state and no carrier handoff.
C. ORDER_PACKING: explicit present packing/packaged/being packed/assembled-for-dispatch state. "Ready for dispatch" without carrier handoff also belongs here. Do not call this SHIPPED until physical dispatch/handoff is stated.
D. SHIPMENT_CREATED: only label/tracking/consignment/pre-advice/shipping data was created or registered. A tracking number alone is not SHIPPED. No physical carrier handoff is established.
E. SHIPPED: explicit first physical dispatch/handoff from seller to carrier: "feladtuk", "átadtuk a futárnak", "útnak indítottuk", dispatched/sent/handed to carrier. A merchant announcement that the order has just left the seller is SHIPPED.
F. IN_TRANSIT: after carrier acceptance/handoff, the carrier reports subsequent network movement such as transport in progress, depot/hub movement or already travelling through the carrier network. Do not use IN_TRANSIT for the seller's initial dispatch announcement.
G. OUT_FOR_DELIVERY: explicit final-mile delivery to the buyer is happening today/currently or the courier is on the final delivery route. A future delivery date alone is not OUT_FOR_DELIVERY.
H. READY_FOR_PICKUP: the parcel is physically waiting for the BUYER at locker/shop/pickup point. Do not confuse this with courier collection from a merchant.
I. DELIVERED: delivery/collection is explicitly completed. Any feedback or survey request after that does not change DELIVERED.
Current explicit status outranks future steps, generic tracking text, legal/footer text and older quoted states.
`;

let inferLock = Promise.resolve();
let warmed = false;

function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readPrompt(req) {
  const length = Number(req.headers['content-length'] || 0);
  if (!Number.isInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) throw new Error('REQUEST_SIZE_REJECTED');
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) throw new Error('REQUEST_SIZE_REJECTED');
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('INVALID_JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) {
    throw new Error('INVALID_REQUEST_CONTRACT');
  }
  return parsed.prompt;
}

async function lemonadeHealth() {
  const response = await fetch(`${LEMONADE_BASE}/health`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`LEMONADE_HEALTH_HTTP_${response.status}`);
  return await response.json();
}

async function infer(prompt, schema, maxNewTokens, schemaName) {
  const response = await fetch(`${LEMONADE_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: BACKEND_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxNewTokens,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LEMONADE_CHAT_HTTP_${response.status}${detail ? `:${detail.slice(0, 300)}` : ''}`);
  }
  const payload = await response.json();
  const output = payload?.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('LEMONADE_OUTPUT_MISSING');
  return output;
}

async function lockedInfer(prompt, schema, maxNewTokens, schemaName) {
  let release;
  const previous = inferLock;
  inferLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await infer(prompt, schema, maxNewTokens, schemaName); } finally { release(); }
}

function runtimePayload(output) {
  return {
    ok: true,
    model_id: EXPOSED_MODEL_ID,
    model_digest: MODEL_DIGEST,
    runtime_version: RUNTIME_VERSION,
    context_tokens: CONTEXT_TOKENS,
    structured_output: 'json_schema',
    deterministic: true,
    experiment_version: EXPERIMENT_VERSION,
    backend: 'lemonade',
    backend_model_id: BACKEND_MODEL,
    model_digest_kind: 'runtime_model_identity_sha256',
    output,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    if (!warmed) return send(res, 503, { ok: false, reason: 'MODEL_NOT_READY' });
    return send(res, 200, {
      ...runtimePayload(undefined),
      output: undefined,
      ok: true,
      warmed: true,
    });
  }

  if (req.method !== 'POST' || (req.url !== '/v1/buyer-gate' && req.url !== '/v1/eventmind')) return send(res, 404, { ok: false });

  try {
    const prompt = await readPrompt(req);
    const gate = req.url === '/v1/buyer-gate';
    const effectivePrompt = `${gate ? V15_GATE_RULES : V15_EVENT_RULES}\n\n${prompt}`;
    const output = await lockedInfer(
      effectivePrompt,
      gate ? BUYER_GATE_SCHEMA : EVENT_SCHEMA,
      gate ? 32 : 48,
      gate ? 'buyflow_v15_buyer_gate' : 'buyflow_v15_event',
    );
    return send(res, 200, runtimePayload(output));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'INFERENCE_FAILED';
    const status = reason === 'REQUEST_SIZE_REJECTED' ? 413 : reason.startsWith('INVALID_') ? 400 : 503;
    return send(res, status, { ok: false, reason });
  }
});

try {
  await lemonadeHealth();
  await infer(
    `${V15_GATE_RULES}\n\nThe mailbox owner received a marketing newsletter with no purchase lifecycle event. Return only the structured gate reason.`,
    BUYER_GATE_SCHEMA,
    32,
    'buyflow_v15_buyer_gate_warmup',
  );
  warmed = true;
  server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({
      ok: true,
      backend: 'lemonade',
      backend_model: BACKEND_MODEL,
      exposed_model_id: EXPOSED_MODEL_ID,
      digest: MODEL_DIGEST,
      digest_kind: 'runtime_model_identity_sha256',
      port: PORT,
      context_tokens: CONTEXT_TOKENS,
      structured_output: 'json_schema',
      experiment_version: EXPERIMENT_VERSION,
      warmed: true,
    }));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
