import type { NormalizedEmailDocumentV1 } from '../email/document-v1.js';
import type { SemanticEventOverride } from '../purchase-identity-v2/extraction-v2-adapter.js';
import { semanticEventOverrideFromPrediction } from '../purchase-identity-v2/semantic-event-overlay.js';
import {
  buildEventMindInputV1,
  EVENTMIND_EVENT_TYPES,
  type EventMindEventType,
  type EventMindPredictionV1,
} from './eventmind-v1.js';

export const EVENTMIND_V14_SOURCE_ID = 'gemma3-12b-buyflow-v14-gated' as const;
export const EVENTMIND_V14_SOURCE_VERSION = 'eventmind-v14-buyer-gate-then-event-v2' as const;
export const EVENTMIND_V14_PROMPT_VERSION = 'gemma3-gated-v14-real120-v2' as const;
export const EVENTMIND_V14_MAX_SEMANTIC_TEXT_CHARS = 20_000 as const;

const RUNTIME_VERSION = 'eventmind-gemma3-gated-v14-runtime-v1';
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

const BUYER_REASONS = new Set<BuyerGateReason>(['BUYER_PURCHASE', 'BUYER_RETURN']);
const ALL_GATE_REASONS = new Set<BuyerGateReason>([
  'BUYER_PURCHASE', 'BUYER_RETURN', 'MERCHANT_OUTBOUND', 'MARKETING_SURVEY',
  'ACCOUNT_SECURITY', 'OTHER_NON_PURCHASE', 'UNCERTAIN',
]);

export interface BuyerGatePrediction {
  buyer_side: boolean;
  reason_code: BuyerGateReason;
}

type FailureReason =
  | 'RUNTIME_DISABLED'
  | 'RUNTIME_CONFIG_INVALID'
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_TIMEOUT'
  | 'RUNTIME_HTTP_ERROR'
  | 'INVALID_RUNTIME_RESPONSE'
  | 'INVALID_GATE_OUTPUT'
  | 'INVALID_MODEL_OUTPUT';

type RuntimeFailureReason =
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_TIMEOUT'
  | 'RUNTIME_HTTP_ERROR'
  | 'INVALID_RUNTIME_RESPONSE';

export type EventMindV14Result =
  | {
      ok: true;
      prediction: EventMindPredictionV1;
      override: SemanticEventOverride;
      gate: BuyerGatePrediction;
      runtime: {
        modelId: typeof MODEL_ID;
        modelDigest: string;
        runtimeVersion: typeof RUNTIME_VERSION;
        contextTokens: typeof CONTEXT_TOKENS;
        structuredOutput: 'json_schema';
        promptVersion: typeof EVENTMIND_V14_PROMPT_VERSION;
        attempts: 1 | 2;
      };
    }
  | {
      ok: false;
      reason: FailureReason;
      detail?: string;
      gate?: BuyerGatePrediction;
      attempts: 0 | 1 | 2;
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

function runtimeConfig(source: NodeJS.ProcessEnv = process.env): RuntimeConfig | null {
  if (source.BUYFLOW_GEMMA_V14_RUNTIME_ENABLED !== 'true') return null;
  const rawUrl = source.BUYFLOW_GEMMA_V14_RUNTIME_URL?.trim();
  const digest = source.BUYFLOW_GEMMA_V14_MODEL_DIGEST?.trim().toLowerCase();
  const timeoutRaw = source.BUYFLOW_GEMMA_V14_TIMEOUT_MS?.trim() || '30000';
  const timeoutMs = Number(timeoutRaw);
  if (!rawUrl || !digest || !SHA256.test(digest) || !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 60_000) {
    throw new Error('V14_RUNTIME_CONFIG_INVALID');
  }
  const url = new URL(rawUrl);
  const local = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (!local) throw new Error('V14_RUNTIME_MUST_BE_LOOPBACK_HTTP');
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return { baseUrl: url.toString().replace(/\/$/, ''), expectedDigest: digest, timeoutMs };
}

function boundedSemanticText(value: string | null): { text: string | null; truncated: boolean } {
  if (value === null || value.length <= EVENTMIND_V14_MAX_SEMANTIC_TEXT_CHARS) {
    return { text: value, truncated: false };
  }
  const head = value.slice(0, 14_000);
  const tail = value.slice(-6_000);
  return { text: `${head}\n\n[MIDDLE OMITTED FOR CONTEXT BUDGET]\n\n${tail}`, truncated: true };
}

function buildView(document: NormalizedEmailDocumentV1) {
  const base = buildEventMindInputV1(document);
  const bounded = boundedSemanticText(base.semanticText);
  return {
    ...base,
    semanticText: bounded.text,
    semanticTextTruncated: base.semanticTextTruncated || bounded.truncated,
  };
}

export function buildBuyerGatePromptV14(document: NormalizedEmailDocumentV1): string {
  const view = buildView(document);
  const instruction = [
    'You are BuyFlow BuyerScopeGate. Choose exactly one reason_code for the CURRENT MAIN EVENT in this inbox email.',
    'The mailbox owner is the person or business account that RECEIVED this email into this inbox. Infer message direction from the content. Commerce, courier, order, parcel, tracking or payment words alone do not prove buyer-side.',
    'BUYER_PURCHASE = the mailbox owner is acting as buyer/recipient in their own order, payment, invoice, incoming shipment, delivery, pickup, refund or warranty lifecycle.',
    'BUYER_RETURN = an explicit return of the mailbox owner own purchase.',
    'MERCHANT_OUTBOUND = seller/merchant/shipper operation, especially courier pickup or collection FROM the mailbox owner, outbound fulfillment, shipping-service administration or parcels the mailbox owner is sending.',
    'MARKETING_SURVEY = marketing, newsletter, promotion or survey without a current purchase lifecycle event. ACCOUNT_SECURITY = account/security/login/admin message. OTHER_NON_PURCHASE = other non-purchase content.',
    'Critical direction rule: courier accepted a pickup request, pickup happens today, or courier comes to collect goods FROM the mailbox owner = MERCHANT_OUTBOUND. Delivery TO the mailbox owner as buyer = BUYER_PURCHASE.',
    'If buyer direction is not positively supported, choose UNCERTAIN. Fail closed rather than guessing buyer-side.',
    'Return only the schema field reason_code, no explanation.',
  ].join(' ');
  return `${instruction}\n\nMAIL_LENS_VIEW:\n${JSON.stringify(view)}`;
}

export function buildBuyerEventPromptV14(document: NormalizedEmailDocumentV1): string {
  const view = buildView(document);
  const instruction = [
    'The buyer-scope gate already determined that this email is about the mailbox owner as a buyer. Choose exactly one CURRENT buyer-side lifecycle event_type.',
    `event_type must be exactly one of: ${EVENTMIND_EVENT_TYPES.join(', ')}.`,
    'Use the primary current status. Subject and direct current-status statements outrank incidental mentions, instructions, future plans, footers and older/history states.',
    'ORDER_CREATED = buyer order received/placed/confirmed/accepted, with no later current stage. ORDER_PROCESSING = currently being processed/prepared. ORDER_PACKING = currently being packed/packed/ready for dispatch but not physically handed to carrier.',
    'SHIPMENT_CREATED = label/tracking/consignment/pre-advice created but no physical handoff. SHIPPED = actually dispatched/sent/handed to carrier, including feladtuk, most adtak fel, or mar uton van when it announces dispatch. IN_TRANSIT = later movement through carrier network after handoff. OUT_FOR_DELIVERY = explicit final-mile delivery to buyer happening today/currently. READY_FOR_PICKUP = physically waiting for buyer at locker/shop/pickup point. DELIVERED = completed delivery/collection. DELIVERY_FAILED = failed delivery attempt. DELAYED = explicit delay/postponement.',
    'PAYMENT = successful/confirmed/charged payment is the main event. INVOICE = invoice/receipt itself was issued/sent/made available. A future or secondary invoice mention does not turn a payment confirmation into INVOICE.',
    'CANCELLED = cancellation. REFUNDED = money actually refunded. RETURN = buyer return process/request/return shipment. WARRANTY = warranty/guarantee lifecycle.',
    'If there is still no positively supported buyer lifecycle event, choose OTHER.',
    'Return only the schema field event_type, no explanation.',
  ].join(' ');
  return `${instruction}\n\nMAIL_LENS_VIEW:\n${JSON.stringify(view)}`;
}

function decodeGate(raw: string): BuyerGatePrediction | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'reason_code' || typeof record.reason_code !== 'string') return null;
  const reason = record.reason_code as BuyerGateReason;
  if (!ALL_GATE_REASONS.has(reason)) return null;
  return { buyer_side: BUYER_REASONS.has(reason), reason_code: reason };
}

function decodeEvent(raw: string): EventMindPredictionV1 | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== 'event_type' || typeof record.event_type !== 'string') return null;
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
  path: '/v1/buyer-gate' | '/v1/eventmind',
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

function successfulResult(
  prediction: EventMindPredictionV1,
  gate: BuyerGatePrediction,
  modelDigest: string,
  attempts: 1 | 2,
): EventMindV14Result {
  const semantic = semanticEventOverrideFromPrediction({
    eventType: prediction.event_type,
    isCommerce: prediction.is_commerce,
  }, {
    sourceId: EVENTMIND_V14_SOURCE_ID,
    sourceVersion: EVENTMIND_V14_SOURCE_VERSION,
  });
  if (!semantic.ok) return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: semantic.reason, gate, attempts };
  return {
    ok: true,
    prediction,
    override: semantic.override,
    gate,
    runtime: {
      modelId: MODEL_ID,
      modelDigest,
      runtimeVersion: RUNTIME_VERSION,
      contextTokens: CONTEXT_TOKENS,
      structuredOutput: 'json_schema',
      promptVersion: EVENTMIND_V14_PROMPT_VERSION,
      attempts,
    },
  };
}

export async function runEventMindV14GemmaGated(
  document: NormalizedEmailDocumentV1,
  source: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<EventMindV14Result> {
  let config: RuntimeConfig | null;
  try {
    config = runtimeConfig(source);
  } catch (error) {
    return { ok: false, reason: 'RUNTIME_CONFIG_INVALID', detail: error instanceof Error ? error.message : String(error), attempts: 0 };
  }
  if (!config) return { ok: false, reason: 'RUNTIME_DISABLED', attempts: 0 };

  const gateCall = await callRuntime('/v1/buyer-gate', buildBuyerGatePromptV14(document), config, fetchImpl);
  if (!gateCall.ok) return { ok: false, reason: gateCall.reason, detail: gateCall.detail, attempts: 1 };

  const gate = decodeGate(gateCall.response.output);
  if (!gate) return { ok: false, reason: 'INVALID_GATE_OUTPUT', attempts: 1 };
  if (!gate.buyer_side) {
    return successfulResult({ is_commerce: false, event_type: 'OTHER' }, gate, gateCall.response.model_digest.toLowerCase(), 1);
  }

  const eventCall = await callRuntime('/v1/eventmind', buildBuyerEventPromptV14(document), config, fetchImpl);
  if (!eventCall.ok) return { ok: false, reason: eventCall.reason, detail: eventCall.detail, gate, attempts: 2 };

  const prediction = decodeEvent(eventCall.response.output);
  if (!prediction) return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: 'INVALID_EVENT_SCHEMA', gate, attempts: 2 };
  return successfulResult(prediction, gate, eventCall.response.model_digest.toLowerCase(), 2);
}
