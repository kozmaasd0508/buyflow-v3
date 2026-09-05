#!/usr/bin/env node
import http from 'node:http';

const MODEL = 'gemma3:12b';
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const PORT = Number(process.env.BUYFLOW_GEMMA_RUNTIME_PORT || '4395');
const PROTOCOL_VERSION = 'buyflow-eventmind-v11-runtime-v1';
const RUNTIME_VERSION = 'eventmind-ollama-gemma3-12b-runtime-v1';
const TEMPLATE_VERSION = 'ollama-gemma3-chat-v1';
const MAX_REQUEST_BYTES = 256_000;
const MAX_NEW_TOKENS = 48;

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

function strictRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'generation,prompt,protocol_version') return null;
  if (value.protocol_version !== PROTOCOL_VERSION) return null;
  if (typeof value.prompt !== 'string' || value.prompt.trim().length === 0) return null;
  const generation = value.generation;
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) return null;
  const gKeys = Object.keys(generation).sort();
  if (gKeys.join(',') !== 'do_sample,enable_thinking,max_new_tokens') return null;
  if (generation.do_sample !== false || generation.enable_thinking !== false || generation.max_new_tokens !== MAX_NEW_TOKENS) return null;
  return value.prompt;
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

async function infer(prompt) {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      keep_alive: '10m',
      options: {
        temperature: 0,
        seed: 0,
        num_predict: MAX_NEW_TOKENS,
      },
    }),
  });
  if (!response.ok) throw new Error(`OLLAMA_CHAT_HTTP_${response.status}`);
  const payload = await response.json();
  const output = payload?.message?.content;
  if (typeof output !== 'string') throw new Error('OLLAMA_OUTPUT_MISSING');
  return output;
}

async function lockedInfer(prompt) {
  let release;
  const previous = inferLock;
  inferLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await infer(prompt);
  } finally {
    release();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    if (!modelDigest) return send(res, 503, { ok: false, reason: 'MODEL_NOT_READY' });
    return send(res, 200, {
      ok: true,
      protocol_version: PROTOCOL_VERSION,
      model_id: MODEL,
      adapter_sha256: modelDigest,
      runtime_version: RUNTIME_VERSION,
      template_version: TEMPLATE_VERSION,
      thinking_enabled: false,
      deterministic: true,
    });
  }

  if (req.method !== 'POST' || req.url !== '/v1/eventmind') {
    return send(res, 404, { ok: false });
  }

  const length = Number(req.headers['content-length'] || 0);
  if (!Number.isInteger(length) || length <= 0 || length > MAX_REQUEST_BYTES) {
    return send(res, 413, { ok: false, reason: 'REQUEST_SIZE_REJECTED' });
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_REQUEST_BYTES) return send(res, 413, { ok: false, reason: 'REQUEST_SIZE_REJECTED' });
    chunks.push(chunk);
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return send(res, 400, { ok: false, reason: 'INVALID_JSON' });
  }

  const prompt = strictRequest(parsed);
  if (!prompt) return send(res, 400, { ok: false, reason: 'INVALID_REQUEST_CONTRACT' });

  try {
    const output = await lockedInfer(prompt);
    return send(res, 200, {
      protocol_version: PROTOCOL_VERSION,
      model_id: MODEL,
      adapter_sha256: modelDigest,
      runtime_version: RUNTIME_VERSION,
      template_version: TEMPLATE_VERSION,
      thinking_enabled: false,
      deterministic: true,
      output,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'INFERENCE_FAILED';
    return send(res, 503, { ok: false, reason });
  }
});

try {
  modelDigest = await resolveModelDigest();
  await infer('Reply with exactly: OK');
  server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({ ok: true, model: MODEL, digest: modelDigest, port: PORT, warmed: true }));
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
