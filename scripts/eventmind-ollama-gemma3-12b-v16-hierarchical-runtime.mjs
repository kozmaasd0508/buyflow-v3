#!/usr/bin/env node
import http from 'node:http';

const MODEL = 'gemma3:12b';
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const PORT = Number(process.env.BUYFLOW_GEMMA_V16_RUNTIME_PORT || '4397');
const CONTEXT_TOKENS = 8192;
const MAX_REQUEST_BYTES = 256_000;
const RUNTIME_VERSION = 'eventmind-gemma3-v16-hierarchical-runtime-v1';
const EXPERIMENT_VERSION = 'eventmind-v16-hierarchical-generalization-v1';

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

const FAMILY_SCHEMA = {
  type: 'object',
  properties: {
    family: {
      type: 'string',
      enum: ['ORDER', 'PARCEL', 'PAYMENT_DOCUMENT', 'RETURN_REFUND', 'WARRANTY', 'UNKNOWN_BUYER'],
    },
  },
  required: ['family'],
  additionalProperties: false,
};

function eventSchema(values) {
  return {
    type: 'object',
    properties: { event_type: { type: 'string', enum: values } },
    required: ['event_type'],
    additionalProperties: false,
  };
}

const ORDER_EVENT_SCHEMA = eventSchema(['ORDER_CREATED', 'ORDER_PROCESSING', 'ORDER_PACKING', 'CANCELLED', 'OTHER']);
const PARCEL_EVENT_SCHEMA = eventSchema([
  'SHIPMENT_CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP',
  'DELIVERED', 'DELIVERY_FAILED', 'DELAYED', 'OTHER',
]);
const PAYMENT_EVENT_SCHEMA = eventSchema(['PAYMENT', 'INVOICE', 'OTHER']);
const RETURN_EVENT_SCHEMA = eventSchema(['RETURN', 'REFUNDED', 'CANCELLED', 'OTHER']);
const WARRANTY_EVENT_SCHEMA = eventSchema(['WARRANTY', 'OTHER']);

const GATE_RULES = `
You are BuyFlow BuyerScopeGate. Decide the direction and scope of the CURRENT MAIN EVENT, not a sender/template identity.
The mailbox owner is the account that RECEIVED this message. Use From/To/Cc/Bcc plus the current authored message as evidence.
BUYER_PURCHASE means the mailbox owner is the buyer/recipient in their own purchase lifecycle.
BUYER_RETURN means the mailbox owner is returning their own purchase.
MERCHANT_OUTBOUND requires positive evidence that the mailbox owner is acting as seller/shipper/merchant, or that goods are being collected FROM the mailbox owner for outbound fulfillment. Courier or parcel vocabulary alone is never enough.
A delivery/pickup/status TO the mailbox owner is buyer-side. A courier pickup FROM the mailbox owner is merchant-outbound.
A current lifecycle event outranks footer marketing, survey, cross-sell, app promotion, legal text and older quoted states.
If the message is pure marketing/survey, account/security/admin, or unrelated non-purchase mail, choose the corresponding non-buyer reason.
If direction genuinely cannot be resolved from explicit evidence, choose UNCERTAIN. Do not guess from brand, sender domain, language or familiar template wording.
Return only reason_code.
`;

const FAMILY_RULES = `
You are BuyFlow LifecycleFamilyGate. The email is already buyer-side. Choose the lifecycle FAMILY of the CURRENT MAIN EVENT from evidence, not from sender identity.
ORDER = before physical carrier possession: order created, accepted, processing, preparation, packing, cancellation before shipment.
PARCEL = shipment logistics from label/pre-advice through physical carrier possession, carrier-network movement, final-mile delivery, pickup-point availability and completed delivery.
PAYMENT_DOCUMENT = payment/charge confirmation or invoice/receipt issuance as the current main event.
RETURN_REFUND = buyer return workflow, return shipment, or money actually refunded.
WARRANTY = warranty/guarantee lifecycle.
UNKNOWN_BUYER = buyer-side purchase mail exists, but no family is positively supported.
Critical phase boundary: once physical carrier possession or carrier-network handling is established, the family is PARCEL even if the carrier uses words like processing, handling or preparation. Seller-side order processing before carrier possession is ORDER.
Tracking/label creation without carrier possession is still PARCEL because it is a shipment lifecycle event.
Current explicit status outranks future steps, generic tracking links, footer text and historical quoted states.
Return only family.
`;

const ORDER_RULES = `
Choose one CURRENT ORDER event only.
ORDER_CREATED = order was just placed/received/accepted/confirmed and there is no later current preparation state.
ORDER_PROCESSING = seller is currently processing/preparing/handling the order before packing and before carrier possession.
ORDER_PACKING = explicit current packing/packed/assembled/ready-for-dispatch state, still before carrier possession.
CANCELLED = order cancellation is the main current event.
If physical carrier possession, shipment movement, payment/document, return/refund or warranty is actually the current event, choose OTHER rather than forcing an ORDER label.
Future wording does not upgrade the current state. Return only event_type.
`;

const PARCEL_RULES = `
Choose one CURRENT PARCEL event only.
SHIPMENT_CREATED = shipment/label/tracking/consignment/pre-advice exists but physical carrier possession is not established.
SHIPPED = first physical dispatch/handoff from seller to carrier is explicitly established; this is the transition into carrier possession.
IN_TRANSIT = after carrier possession, the carrier reports subsequent depot/hub/network movement or physical processing inside its logistics network. Carrier words such as processed/handled at a depot are logistics movement, not ORDER_PROCESSING.
OUT_FOR_DELIVERY = explicit final-mile delivery to the buyer is happening now/today or the parcel is with the delivery courier for the final route.
READY_FOR_PICKUP = parcel is physically waiting for the buyer at a locker/shop/post/pickup point.
DELIVERED = delivery or buyer collection is completed.
DELIVERY_FAILED = delivery attempt failed.
DELAYED = explicit shipment delay/postponement is the main current event.
Do not use SHIPPED for mere label creation. Do not use IN_TRANSIT for the seller's initial handoff announcement. Current explicit status outranks future estimates and old states. Return only event_type.
`;

const PAYMENT_RULES = `
Choose one CURRENT PAYMENT_DOCUMENT event only.
PAYMENT = successful/confirmed/charged payment is the main current event.
INVOICE = invoice/receipt itself was issued, sent or made available as the main event.
A future or secondary invoice mention does not replace a payment confirmation. Return only event_type.
`;

const RETURN_RULES = `
Choose one CURRENT RETURN_REFUND event only.
RETURN = buyer return process/request/return shipment is active.
REFUNDED = money has actually been refunded.
CANCELLED = cancellation is the main current event and belongs to this return/refund context.
Return only event_type.
`;

const WARRANTY_RULES = `
Choose WARRANTY only when the current main event is an explicit warranty/guarantee lifecycle event. Otherwise choose OTHER. Return only event_type.
`;

const ROUTES = new Map([
  ['/v1/buyer-gate', { schema: BUYER_GATE_SCHEMA, rules: GATE_RULES, maxNewTokens: 32 }],
  ['/v1/lifecycle-family', { schema: FAMILY_SCHEMA, rules: FAMILY_RULES, maxNewTokens: 24 }],
  ['/v1/event-order', { schema: ORDER_EVENT_SCHEMA, rules: ORDER_RULES, maxNewTokens: 32 }],
  ['/v1/event-parcel', { schema: PARCEL_EVENT_SCHEMA, rules: PARCEL_RULES, maxNewTokens: 32 }],
  ['/v1/event-payment', { schema: PAYMENT_EVENT_SCHEMA, rules: PAYMENT_RULES, maxNewTokens: 24 }],
  ['/v1/event-return', { schema: RETURN_EVENT_SCHEMA, rules: RETURN_RULES, maxNewTokens: 24 }],
  ['/v1/event-warranty', { schema: WARRANTY_EVENT_SCHEMA, rules: WARRANTY_RULES, maxNewTokens: 20 }],
]);

let modelDigest = null;
let inferLock = Promise.resolve();

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

async function resolveModelDigest() {
  const response = await fetch(`${OLLAMA_BASE}/api/tags`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`OLLAMA_TAGS_HTTP_${response.status}`);
  const payload = await response.json();
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const match = models.find((item) => item?.name === MODEL || item?.model === MODEL);
  if (!match) throw new Error(`OLLAMA_MODEL_NOT_INSTALLED:${MODEL}`);
  const digest = String(match.digest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('OLLAMA_MODEL_DIGEST_INVALID');
  return digest;
}

async function infer(prompt, schema, maxNewTokens) {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      format: schema,
      keep_alive: '10m',
      options: { temperature: 0, seed: 0, num_ctx: CONTEXT_TOKENS, num_predict: maxNewTokens },
    }),
  });
  if (!response.ok) throw new Error(`OLLAMA_CHAT_HTTP_${response.status}`);
  const payload = await response.json();
  const output = payload?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('OLLAMA_OUTPUT_MISSING');
  return output;
}

async function lockedInfer(prompt, schema, maxNewTokens) {
  let release;
  const previous = inferLock;
  inferLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await infer(prompt, schema, maxNewTokens); } finally { release(); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    if (!modelDigest) return send(res, 503, { ok: false, reason: 'MODEL_NOT_READY' });
    return send(res, 200, {
      ok: true,
      model_id: MODEL,
      model_digest: modelDigest,
      runtime_version: RUNTIME_VERSION,
      context_tokens: CONTEXT_TOKENS,
      structured_output: 'json_schema',
      deterministic: true,
      experiment_version: EXPERIMENT_VERSION,
      hierarchy: 'buyer_gate->family_gate->family_restricted_event',
    });
  }

  if (req.method !== 'POST') return send(res, 404, { ok: false });
  const route = ROUTES.get(req.url);
  if (!route) return send(res, 404, { ok: false });

  try {
    const prompt = await readPrompt(req);
    const effectivePrompt = `${route.rules}\n\n${prompt}`;
    const output = await lockedInfer(effectivePrompt, route.schema, route.maxNewTokens);
    return send(res, 200, {
      ok: true,
      model_id: MODEL,
      model_digest: modelDigest,
      runtime_version: RUNTIME_VERSION,
      context_tokens: CONTEXT_TOKENS,
      structured_output: 'json_schema',
      deterministic: true,
      experiment_version: EXPERIMENT_VERSION,
      output,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'INFERENCE_FAILED';
    const status = reason === 'REQUEST_SIZE_REJECTED' ? 413 : reason.startsWith('INVALID_') ? 400 : 503;
    return send(res, status, { ok: false, reason });
  }
});

try {
  modelDigest = await resolveModelDigest();
  await infer(
    `${GATE_RULES}\n\nThe mailbox owner received a generic promotional newsletter with no current purchase lifecycle event.`,
    BUYER_GATE_SCHEMA,
    32,
  );
  server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({
      ok: true,
      model: MODEL,
      digest: modelDigest,
      port: PORT,
      runtime_version: RUNTIME_VERSION,
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
