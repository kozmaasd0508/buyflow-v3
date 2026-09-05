#!/usr/bin/env node
import http from 'node:http';

const MODEL = 'gemma3:12b';
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const PORT = Number(process.env.BUYFLOW_GEMMA_V14_RUNTIME_PORT || '4396');
const CONTEXT_TOKENS = 8192;
const MAX_REQUEST_BYTES = 256_000;

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
  if (!Number.isInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) {
    throw new Error('REQUEST_SIZE_REJECTED');
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) throw new Error('REQUEST_SIZE_REJECTED');
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
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
      options: {
        temperature: 0,
        seed: 0,
        num_ctx: CONTEXT_TOKENS,
        num_predict: maxNewTokens,
      },
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
  try {
    return await infer(prompt, schema, maxNewTokens);
  } finally {
    release();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    if (!modelDigest) return send(res, 503, { ok: false, reason: 'MODEL_NOT_READY' });
    return send(res, 200, {
      ok: true,
      model_id: MODEL,
      model_digest: modelDigest,
      runtime_version: 'eventmind-gemma3-gated-v14-runtime-v1',
      context_tokens: CONTEXT_TOKENS,
      structured_output: 'json_schema',
      deterministic: true,
    });
  }

  if (req.method !== 'POST' || (req.url !== '/v1/buyer-gate' && req.url !== '/v1/eventmind')) {
    return send(res, 404, { ok: false });
  }

  try {
    const prompt = await readPrompt(req);
    const gate = req.url === '/v1/buyer-gate';
    const output = await lockedInfer(prompt, gate ? BUYER_GATE_SCHEMA : EVENT_SCHEMA, gate ? 32 : 48);
    return send(res, 200, {
      ok: true,
      model_id: MODEL,
      model_digest: modelDigest,
      runtime_version: 'eventmind-gemma3-gated-v14-runtime-v1',
      context_tokens: CONTEXT_TOKENS,
      structured_output: 'json_schema',
      deterministic: true,
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
    'The mailbox owner received a marketing newsletter with no purchase lifecycle event. Return only the structured gate reason.',
    BUYER_GATE_SCHEMA,
    32,
  );
  server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({
      ok: true,
      model: MODEL,
      digest: modelDigest,
      port: PORT,
      context_tokens: CONTEXT_TOKENS,
      structured_output: 'json_schema',
      warmed: true,
    }));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
