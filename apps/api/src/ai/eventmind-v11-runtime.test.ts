import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  EVENTMIND_V11_MODEL_ID,
  EVENTMIND_V11_RUNTIME_PROTOCOL,
  EVENTMIND_V11_RUNTIME_VERSION,
  EVENTMIND_V11_TEMPLATE_VERSION,
  eventMindV11RuntimeConfigFromEnvironment,
  runEventMindV11,
  type EventMindV11RuntimeConfig,
} from './eventmind-v11-runtime.js';

const ADAPTER_SHA = 'a'.repeat(64);

function sourceEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: 'provider-secret-123',
    providerThreadId: 'thread-secret-456',
    subject: 'Package update',
    from: [{ email: 'shipping@shop.example', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-09-02T12:00:00.000Z',
    folders: ['CATEGORY_PURCHASES'],
    attachments: [],
    bodyText: [
      'Current status: your package is in transit.',
      '----- Original Message -----',
      'Old status: delivered.',
      'Internal candidate PURCHASE-SECRET-999.',
    ].join('\n'),
    ...overrides,
  };
}

function enabledConfig(overrides: Partial<Extract<EventMindV11RuntimeConfig, { enabled: true }>> = {}): Extract<EventMindV11RuntimeConfig, { enabled: true }> {
  return {
    enabled: true,
    endpoint: 'http://127.0.0.1:4394/v1/eventmind',
    expectedAdapterSha256: ADAPTER_SHA,
    expectedModelId: EVENTMIND_V11_MODEL_ID,
    expectedRuntimeVersion: EVENTMIND_V11_RUNTIME_VERSION,
    expectedTemplateVersion: EVENTMIND_V11_TEMPLATE_VERSION,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function runtimePayload(overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: EVENTMIND_V11_RUNTIME_PROTOCOL,
    model_id: EVENTMIND_V11_MODEL_ID,
    adapter_sha256: ADAPTER_SHA,
    runtime_version: EVENTMIND_V11_RUNTIME_VERSION,
    template_version: EVENTMIND_V11_TEMPLATE_VERSION,
    thinking_enabled: false,
    deterministic: true,
    output: '{"is_commerce":true,"event_type":"IN_TRANSIT"}',
    ...overrides,
  };
}

test('EventMind V11 runtime is disabled by default and enablement requires an exact adapter SHA', () => {
  assert.deepEqual(eventMindV11RuntimeConfigFromEnvironment({}), { enabled: false });
  assert.throws(() => eventMindV11RuntimeConfigFromEnvironment({
    BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED: 'true',
    BUYFLOW_EVENTMIND_V11_RUNTIME_URL: 'http://127.0.0.1:4394/v1/eventmind',
  }), /ADAPTER_SHA256/);
  assert.throws(() => eventMindV11RuntimeConfigFromEnvironment({
    BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED: 'true',
    BUYFLOW_EVENTMIND_V11_RUNTIME_URL: 'http://remote.example/v1/eventmind',
    BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256: ADAPTER_SHA,
  }), /HTTPS or loopback HTTP/);
});

test('successful V11 call uses only MailLens EventMind prompt and fixed thinking-off deterministic settings', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  let requestBody: Record<string, unknown> | null = null;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(runtimePayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const result = await runEventMindV11(document, enabledConfig(), fetchImpl);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.prediction.event_type, 'IN_TRANSIT');
  assert.equal(result.override.semanticLabel, 'IN_TRANSIT');
  assert.equal('purchaseId' in result.override, false);
  assert.equal('orderId' in result.override, false);
  assert.equal('trackingId' in result.override, false);

  assert.ok(requestBody);
  const serialized = JSON.stringify(requestBody);
  assert.match(serialized, /in transit/i);
  assert.doesNotMatch(serialized, /Old status: delivered/i);
  assert.doesNotMatch(serialized, /PURCHASE-SECRET-999/);
  assert.doesNotMatch(serialized, /provider-secret-123/);
  assert.doesNotMatch(serialized, /thread-secret-456/);
  assert.match(serialized, /"do_sample":false/);
  assert.match(serialized, /"enable_thinking":false/);
  assert.match(serialized, /"max_new_tokens":48/);
});

test('V11 runtime rejects wrong model metadata and identity-bearing model output', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const wrongMetadataFetch = (async () => new Response(JSON.stringify(runtimePayload({
    adapter_sha256: 'b'.repeat(64),
  })), { status: 200 })) as typeof fetch;
  const metadataResult = await runEventMindV11(document, enabledConfig(), wrongMetadataFetch);
  assert.deepEqual(metadataResult, { ok: false, reason: 'RUNTIME_METADATA_MISMATCH' });

  const identityOutputFetch = (async () => new Response(JSON.stringify(runtimePayload({
    output: '{"is_commerce":true,"event_type":"IN_TRANSIT","purchase_id":"p-1"}',
  })), { status: 200 })) as typeof fetch;
  const outputResult = await runEventMindV11(document, enabledConfig(), identityOutputFetch);
  assert.equal(outputResult.ok, false);
  if (outputResult.ok) return;
  assert.equal(outputResult.reason, 'INVALID_MODEL_OUTPUT');
  assert.equal(outputResult.detail, 'INVALID_SCHEMA');
});

test('V11 runtime fails closed on unavailable, timeout and malformed responses', async () => {
  const document = normalizeEmailDocumentV1(sourceEmail());
  const unavailableFetch = (async () => {
    throw new Error('connection refused');
  }) as typeof fetch;
  const unavailable = await runEventMindV11(document, enabledConfig(), unavailableFetch);
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.reason, 'RUNTIME_UNAVAILABLE');

  const timeoutFetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })) as typeof fetch;
  const timedOut = await runEventMindV11(document, enabledConfig({ timeoutMs: 5 }), timeoutFetch);
  assert.deepEqual(timedOut, { ok: false, reason: 'RUNTIME_TIMEOUT' });

  const malformedFetch = (async () => new Response('{not-json', { status: 200 })) as typeof fetch;
  const malformed = await runEventMindV11(document, enabledConfig(), malformedFetch);
  assert.deepEqual(malformed, { ok: false, reason: 'INVALID_RUNTIME_RESPONSE' });
});
