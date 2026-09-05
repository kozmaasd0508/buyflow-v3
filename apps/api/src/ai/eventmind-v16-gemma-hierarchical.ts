import type { NormalizedEmailDocumentV1 } from '../email/document-v1.js';
import type { SemanticEventOverride } from '../purchase-identity-v2/extraction-v2-adapter.js';
import { semanticEventOverrideFromPrediction } from '../purchase-identity-v2/semantic-event-overlay.js';
import {
  buildEventMindInputV1,
  EVENTMIND_EVENT_TYPES,
  type EventMindEventType,
  type EventMindPredictionV1,
} from './eventmind-v1.js';

export const EVENTMIND_V16_SOURCE_ID = 'gemma3-12b-buyflow-v16-hierarchical' as const;
export const EVENTMIND_V16_SOURCE_VERSION = 'eventmind-v16-buyer-family-event-v1' as const;
export const EVENTMIND_V16_PROMPT_VERSION = 'gemma3-v16-hierarchical-generalization-v1' as const;
export const EVENTMIND_V16_MAX_SEMANTIC_TEXT_CHARS = 20_000 as const;

const RUNTIME_VERSION = 'eventmind-gemma3-v16-hierarchical-runtime-v1';
const MODEL_ID = 'gemma3:12b';
const CONTEXT_TOKENS = 8192;
const SHA256 = /^[a-f0-9]{64}$/i;
const VALID_EVENTS = new Set<string>(EVENTMIND_EVENT_TYPES);

export type BuyerGateReason =
  | 'BUYER_PURCHASE'
  | 'BUYER_RETURN'
  | 'MERCHANT_OUTBOUND'
  | 'MARKETING_SURVEY'
  | 'ACCOUNT_SECURITY'
  | 'OTHER_NON_PURCHASE'
  | 'UNCERTAIN';

export type LifecycleFamily =
  | 'ORDER'
  | 'PARCEL'
  | 'PAYMENT_DOCUMENT'
  | 'RETURN_REFUND'
  | 'WARRANTY'
  | 'UNKNOWN_BUYER';

const BUYER_REASONS = new Set<BuyerGateReason>(['BUYER_PURCHASE', 'BUYER_RETURN']);
const ALL_GATE_REASONS = new Set<BuyerGateReason>([
  'BUYER_PURCHASE', 'BUYER_RETURN', 'MERCHANT_OUTBOUND', 'MARKETING_SURVEY',
  'ACCOUNT_SECURITY', 'OTHER_NON_PURCHASE', 'UNCERTAIN',
]);
const ALL_FAMILIES = new Set<LifecycleFamily>([
  'ORDER', 'PARCEL', 'PAYMENT_DOCUMENT', 'RETURN_REFUND', 'WARRANTY', 'UNKNOWN_BUYER',
]);

export interface BuyerGatePrediction {
  buyer_side: boolean;
  reason_code: BuyerGateReason;
}

export interface FamilyPrediction {
  family: LifecycleFamily;
}

type FailureReason =
  | 'RUNTIME_DISABLED'
  | 'RUNTIME_CONFIG_INVALID'
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_TIMEOUT'
  | 'RUNTIME_HTTP_ERROR'
  | 'INVALID_RUNTIME_RESPONSE'
  | 'INVALID_GATE_OUTPUT'
  | 'INVALID_FAMILY_OUTPUT'
  | 'INVALID_MODEL_OUTPUT';

type RuntimeFailureReason =
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_TIMEOUT'
  | 'RUNTIME_HTTP_ERROR'
  | 'INVALID_RUNTIME_RESPONSE';

export type EventMindV16Result =
  | {
      ok: true;
      prediction: EventMindPredictionV1;
      override: SemanticEventOverride;
      gate: BuyerGatePrediction;
      family: LifecycleFamily | null;
      runtime: {
        modelId: typeof MODEL_ID;
        modelDigest: string;
        runtimeVersion: typeof RUNTIME_VERSION;
        contextTokens: typeof CONTEXT_TOKENS;
        structuredOutput: 'json_schema';
        promptVersion: typeof EVENTMIND_V16_PROMPT_VERSION;
        attempts: 1 | 2 | 3;
      };
      attempts: 1 | 2 | 3;
    }
  | {
      ok: false;
      reason: FailureReason;
      detail?: string;
      gate?: BuyerGatePrediction;
      family?: LifecycleFamily | null;
      attempts: 0 | 1 | 2 | 3;
    };

interface RuntimeConfig {
  baseUrl: string;
  expectedDigest: string;
  timeoutMs: number;
}

interface RuntimeResponse {
  ok: true;
  model_id: typeof MODEL_ID;
  model_digest: string;
  runtime_version: typeof RUNTIME_VERSION;
  context_tokens: typeof CONTEXT_TOKENS;
  structured_output: 'json_schema';
  deterministic: true;
  output: string;
}

type RuntimeCallResult =
  | { ok: true; response: RuntimeResponse }
  | { ok: false; reason: RuntimeFailureReason; detail?: string };

type RuntimePath =
  | '/v1/buyer-gate'
  | '/v1/lifecycle-family'
  | '/v1/event-order'
  | '/v1/event-parcel'
  | '/v1/event-payment'
  | '/v1/event-return'
  | '/v1/event-warranty';

function runtimeConfig(source: NodeJS.ProcessEnv = process.env): RuntimeConfig | null {
  if (source.BUYFLOW_GEMMA_V16_RUNTIME_ENABLED !== 'true') return null;
  const rawUrl = source.BUYFLOW_GEMMA_V16_RUNTIME_URL?.trim();
  const digest = source.BUYFLOW_GEMMA_V16_MODEL_DIGEST?.trim().toLowerCase();
  const timeoutRaw = source.BUYFLOW_GEMMA_V16_TIMEOUT_MS?.trim() || '30000';
  const timeoutMs = Number(timeoutRaw);
  if (!rawUrl || !digest || !SHA256.test(digest) || !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 60_000) {
    throw new Error('V16_RUNTIME_CONFIG_INVALID');
  }
  const url = new URL(rawUrl);
  const local = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (!local) throw new Error('V16_RUNTIME_MUST_BE_LOOPBACK_HTTP');
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return { baseUrl: url.toString().replace(/\/$/, ''), expectedDigest: digest, timeoutMs };
}

function boundedSemanticText(value: string | null): { text: string | null; truncated: boolean } {
  if (value === null || value.length <= EVENTMIND_V16_MAX_SEMANTIC_TEXT_CHARS) {
    return { text: value, truncated: false };
  }
  const head = value.slice(0, 14_000);
  const tail = value.slice(-6_000);
  return { text: `${head}\n\n[MIDDLE OMITTED FOR CONTEXT BUDGET]\n\n${tail}`, truncated: true };
}

function compactAddresses(values: NormalizedEmailDocumentV1['to']) {
  return values.map((item) => ({ email: item.email, ...(item.name ? { name: item.name } : {}) }));
}

function buildView(document: NormalizedEmailDocumentV1) {
  const base = buildEventMindInputV1(document);
  const bounded = boundedSemanticText(base.semanticText);
  return {
    ...base,
    semanticText: bounded.text,
    semanticTextTruncated: base.semanticTextTruncated || bounded.truncated,
    recipients: {
      to: compactAddresses(document.to),
      cc: compactAddresses(document.cc),
      bcc: compactAddresses(document.bcc),
    },
  };
}

export function buildBuyerGatePromptV16(document: NormalizedEmailDocumentV1): string {
  return [
    'Classify buyer scope from the evidence in MAIL_LENS_VIEW.',
    'Do not use brand familiarity or template memory. Use current event semantics and message direction.',
    'The mailbox owner received this email. From/To/Cc/Bcc are directional evidence but not sufficient alone.',
    'Return only reason_code.',
    '',
    'MAIL_LENS_VIEW:',
    JSON.stringify(buildView(document)),
  ].join('\n');
}

export function buildLifecycleFamilyPromptV16(document: NormalizedEmailDocumentV1): string {
  return [
    'The buyer-scope gate already decided this is buyer-side.',
    'Choose the lifecycle family of the CURRENT MAIN EVENT from semantic evidence.',
    'Do not classify by sender brand or memorized template.',
    'Return only family.',
    '',
    'MAIL_LENS_VIEW:',
    JSON.stringify(buildView(document)),
  ].join('\n');
}

export function buildFamilyEventPromptV16(document: NormalizedEmailDocumentV1, family: LifecycleFamily): string {
  return [
    `The buyer-scope gate and family gate already selected family=${family}.`,
    'Choose the single CURRENT event_type allowed by this family.',
    'Use current explicit state, not sender identity, future steps, footer text or old quoted history.',
    'Return only event_type.',
    '',
    'MAIL_LENS_VIEW:',
    JSON.stringify(buildView(document)),
  ].join('\n');
}

function decodeGate(raw: string): BuyerGatePrediction | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.reason_code !== 'string') return null;
  const reason = record.reason_code as BuyerGateReason;
  if (!ALL_GATE_REASONS.has(reason)) return null;
  return { buyer_side: BUYER_REASONS.has(reason), reason_code: reason };
}

function decodeFamily(raw: string): FamilyPrediction | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.family !== 'string') return null;
  const family = record.family as LifecycleFamily;
  if (!ALL_FAMILIES.has(family)) return null;
  return { family };
}

function decodeEvent(raw: string): EventMindPredictionV1 | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.event_type !== 'string') return null;
  if (!VALID_EVENTS.has(record.event_type)) return null;
  const eventType = record.event_type as EventMindEventType;
  return { event_type: eventType, is_commerce: eventType !== 'OTHER' };
}

function validateRuntimeResponse(value: unknown, config: RuntimeConfig): RuntimeResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.ok !== true
    || record.model_id !== MODEL_ID
    || typeof record.model_digest !== 'string'
    || record.model_digest.toLowerCase() !== config.expectedDigest
    || record.runtime_version !== RUNTIME_VERSION
    || record.context_tokens !== CONTEXT_TOKENS
    || record.structured_output !== 'json_schema'
    || record.deterministic !== true
    || typeof record.output !== 'string'
  ) return null;
  return record as unknown as RuntimeResponse;
}

async function callRuntime(
  path: RuntimePath,
  prompt: string,
  config: RuntimeConfig,
  fetchImpl: typeof fetch,
): Promise<RuntimeCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'RUNTIME_HTTP_ERROR', detail: `HTTP ${response.status}` };
    let parsed: unknown;
    try { parsed = await response.json(); } catch { return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE' }; }
    const runtime = validateRuntimeResponse(parsed, config);
    if (!runtime) return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE' };
    return { ok: true, response: runtime };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: 'RUNTIME_TIMEOUT' };
    return { ok: false, reason: 'RUNTIME_UNAVAILABLE', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function eventPathForFamily(family: LifecycleFamily): RuntimePath | null {
  switch (family) {
    case 'ORDER': return '/v1/event-order';
    case 'PARCEL': return '/v1/event-parcel';
    case 'PAYMENT_DOCUMENT': return '/v1/event-payment';
    case 'RETURN_REFUND': return '/v1/event-return';
    case 'WARRANTY': return '/v1/event-warranty';
    case 'UNKNOWN_BUYER': return null;
  }
}

function successfulResult(
  prediction: EventMindPredictionV1,
  gate: BuyerGatePrediction,
  family: LifecycleFamily | null,
  modelDigest: string,
  attempts: 1 | 2 | 3,
): EventMindV16Result {
  const semantic = semanticEventOverrideFromPrediction({
    eventType: prediction.event_type,
    isCommerce: prediction.is_commerce,
  }, {
    sourceId: EVENTMIND_V16_SOURCE_ID,
    sourceVersion: EVENTMIND_V16_SOURCE_VERSION,
  });
  if (!semantic.ok) return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: semantic.reason, gate, family, attempts };
  return {
    ok: true,
    prediction,
    override: semantic.override,
    gate,
    family,
    attempts,
    runtime: {
      modelId: MODEL_ID,
      modelDigest,
      runtimeVersion: RUNTIME_VERSION,
      contextTokens: CONTEXT_TOKENS,
      structuredOutput: 'json_schema',
      promptVersion: EVENTMIND_V16_PROMPT_VERSION,
      attempts,
    },
  };
}

export async function runEventMindV16GemmaHierarchical(
  document: NormalizedEmailDocumentV1,
  source: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EventMindV16Result> {
  let config: RuntimeConfig | null;
  try {
    config = runtimeConfig(source);
  } catch (error) {
    return { ok: false, reason: 'RUNTIME_CONFIG_INVALID', detail: error instanceof Error ? error.message : String(error), attempts: 0 };
  }
  if (!config) return { ok: false, reason: 'RUNTIME_DISABLED', attempts: 0 };

  const gateCall = await callRuntime('/v1/buyer-gate', buildBuyerGatePromptV16(document), config, fetchImpl);
  if (!gateCall.ok) return { ok: false, reason: gateCall.reason, detail: gateCall.detail, attempts: 1 };

  const gate = decodeGate(gateCall.response.output);
  if (!gate) return { ok: false, reason: 'INVALID_GATE_OUTPUT', attempts: 1 };
  const modelDigest = gateCall.response.model_digest.toLowerCase();
  if (!gate.buyer_side) {
    return successfulResult({ is_commerce: false, event_type: 'OTHER' }, gate, null, modelDigest, 1);
  }

  const familyCall = await callRuntime('/v1/lifecycle-family', buildLifecycleFamilyPromptV16(document), config, fetchImpl);
  if (!familyCall.ok) return { ok: false, reason: familyCall.reason, detail: familyCall.detail, gate, attempts: 2 };
  const familyPrediction = decodeFamily(familyCall.response.output);
  if (!familyPrediction) return { ok: false, reason: 'INVALID_FAMILY_OUTPUT', gate, attempts: 2 };
  const family = familyPrediction.family;
  const eventPath = eventPathForFamily(family);
  if (!eventPath) {
    return successfulResult({ is_commerce: false, event_type: 'OTHER' }, gate, family, modelDigest, 2);
  }

  const eventCall = await callRuntime(eventPath, buildFamilyEventPromptV16(document, family), config, fetchImpl);
  if (!eventCall.ok) return { ok: false, reason: eventCall.reason, detail: eventCall.detail, gate, family, attempts: 3 };
  const prediction = decodeEvent(eventCall.response.output);
  if (!prediction) return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: 'INVALID_EVENT_SCHEMA', gate, family, attempts: 3 };
  return successfulResult(prediction, gate, family, modelDigest, 3);
}
