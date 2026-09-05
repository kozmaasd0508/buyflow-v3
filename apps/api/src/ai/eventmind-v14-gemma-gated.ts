import type { NormalizedEmailDocumentV1 } from '../email/document-v1.js';
import type { SemanticEventOverride } from '../purchase-identity-v2/extraction-v2-adapter.js';
import { semanticEventOverrideFromPrediction } from '../purchase-identity-v2/semantic-event-overlay.js';
import {
  buildEventMindInputV1,
  decodeEventMindPredictionV1,
  EVENTMIND_EVENT_TYPES,
  type EventMindPredictionV1,
} from './eventmind-v1.js';

export const EVENTMIND_V14_SOURCE_ID = 'gemma3-12b-buyflow-v14-gated' as const;
export const EVENTMIND_V14_SOURCE_VERSION = 'eventmind-v14-buyer-gate-then-event-v1' as const;
export const EVENTMIND_V14_PROMPT_VERSION = 'gemma3-gated-v14-real120-v1' as const;
export const EVENTMIND_V14_MAX_SEMANTIC_TEXT_CHARS = 20_000 as const;

const RUNTIME_VERSION = 'eventmind-gemma3-gated-v14-runtime-v1';
const MODEL_ID = 'gemma3:12b';
const CONTEXT_TOKENS = 8192;
const SHA256 = /^[a-f0-9]{64}$/i;

export type BuyerGateReason =
  | 'BUYER_PURCHASE'
  | 'BUYER_RETURN'
  | 'MERCHANT_OUTBOUND'
  | 'MARKETING_SURVEY'
  | 'ACCOUNT_SECURITY'
  | 'OTHER_NON_PURCHASE'
  | 'UNCERTAIN';

export interface BuyerGatePrediction {
  buyer_side: boolean;
  reason_code: BuyerGateReason;
}

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
      reason:
        | 'RUNTIME_DISABLED'
        | 'RUNTIME_CONFIG_INVALID'
        | 'RUNTIME_UNAVAILABLE'
        | 'RUNTIME_TIMEOUT'
        | 'RUNTIME_HTTP_ERROR'
        | 'INVALID_RUNTIME_RESPONSE'
        | 'INVALID_GATE_OUTPUT'
        | 'INVALID_MODEL_OUTPUT';
      detail?: string;
      gate?: BuyerGatePrediction;
      attempts: 0 | 1 | 2;
    };

interface RuntimeConfig {
  enabled: boolean;
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
  return { enabled: true, baseUrl: url.toString().replace(/\/$/, ''), expectedDigest: digest, timeoutMs };
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
    'You are BuyFlow BuyerScopeGate. Decide only whether the CURRENT MAIN EVENT in this inbox email is about the mailbox owner acting as a buyer/recipient of their own purchase.',
    'The mailbox owner is the person or business account that RECEIVED this email into this inbox. Infer direction from the message itself. Do not assume that commerce, courier, order, parcel, tracking or payment words mean buyer-side.',
    'Set buyer_side=true only for the mailbox owner own purchase lifecycle: their order, payment, invoice, incoming shipment, delivery, pickup, refund, return or warranty.',
    'Set buyer_side=false for merchant/seller/outbound operations, including a courier collecting parcels FROM the mailbox owner, shipping-service administration, fulfillment operations, merchant dashboards, marketing, surveys, account/security messages, or unrelated content.',
    'Critical direction rule: courier accepted a pickup request / pickup happens today / courier comes to collect goods FROM the mailbox owner = MERCHANT_OUTBOUND and buyer_side=false. Delivery TO the mailbox owner as buyer = buyer_side=true.',
    'If the direction or buyer role is not positively supported, choose UNCERTAIN and buyer_side=false. This gate is fail-closed.',
    'reason_code must match the decision: BUYER_PURCHASE or BUYER_RETURN require buyer_side=true; all other reason codes require buyer_side=false.',
    'Return only the schema fields, no explanation.',
  ].join(' ');
  return `${instruction}\n\nMAIL_LENS_VIEW:\n${JSON.stringify(view)}`;
}

export function buildBuyerEventPromptV14(document: NormalizedEmailDocumentV1): string {
  const view = buildView(document);
  const instruction = [
    'The buyer-scope gate already determined that this email is about the mailbox owner as a buyer. Classify exactly one CURRENT buyer-side lifecycle event.',
    `event_type must be exactly one of: ${EVENTMIND_EVENT_TYPES.join(', ')}.`,
    'Use the primary current status. Subject and direct current-status statements outrank incidental mentions, instructions, future plans, footers and older/history states.',
    'ORDER_CREATED = buyer order received/placed/confirmed/accepted, with no later current stage. ORDER_PROCESSING = currently being processed/prepared. ORDER_PACKING = currently being packed/packed/ready for dispatch but not physically handed to carrier.',
    'SHIPMENT_CREATED = label/tracking/consignment/pre-advice created but no physical handoff. SHIPPED = actually dispatched/sent/handed to carrier, including feladtuk, most adtak fel, mar uton van when it announces dispatch. IN_TRANSIT = later movement through carrier network after handoff. OUT_FOR_DELIVERY = explicit final-mile delivery to buyer happening today/currently. READY_FOR_PICKUP = physically waiting for buyer at locker/shop/pickup point. DELIVERED = completed delivery/collection. DELIVERY_FAILED = failed delivery attempt. DELAYED = explicit delay/postponement.',
    'PAYMENT = successful/confirmed/charged payment is the main event. INVOICE = invoice/receipt itself was issued/sent/made available. A future or secondary invoice mention does not turn a payment confirmation into INVOICE.',
    'CANCELLED = cancellation. REFUNDED = money actually refunded. RETURN = buyer return process/request/return shipment. WARRANTY = warranty/guarantee lifecycle.',
    'If there is still no positively supported buyer lifecycle event, choose OTHER.',
    'First choose event_type, then set is_commerce=false exactly for OTHER and true for every other event.',
    'Return only the schema fields, no explanation.',
  ].join(' ');
  return `${instruction}\n\nMAIL_LENS_VIEW:\n${JSON.stringify(view)}`;
}

function decodeGate(raw: string): BuyerGatePrediction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'buyer_side' || keys[1] !== 'reason_code') return null;
  if (typeof record.buyer_side !== 'boolean' || typeof record.reason_code !== 'string') return null;
  const reasons = new Set<BuyerGateReason>([
    'BUYER_PURCHASE', 'BUYER_RETURN', 'MERCHANT_OUTBOUND', 'MARKETING_SURVEY',
    'ACCOUNT_SECURITY', 'OTHER_NON_PURCHASE', 'UNCERTAIN',
  ]);
  if (!reasons.has(record.reason_code as BuyerGateReason)) return null;
  const reason = record.reason_code as BuyerGateReason;
  const expectedBuyer = reason === 'BUYER_PURCHASE' || reason === 'BUYER_RETURN';
  if (record.buyer_side !== expectedBuyer) return null;
  return { buyer_side: record.buyer_side, reason_code: reason };
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
): Promise<{ ok: true; response: RuntimeResponse } | { ok: false; reason: EventMindV14Result extends infer _T ? string : never; detail?: string }> {
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
    try {
      parsed = await response.json();
    } catch {
      return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE' };
    }
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
  if (!semantic.ok) {
    return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: semantic.reason, gate, attempts };
  }
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
  if (!gateCall.ok) {
    return { ok: false, reason: gateCall.reason as EventMindV14Result extends { ok: false; reason: infer R } ? R : never, detail: gateCall.detail, attempts: 1 };
  }
  const gate = decodeGate(gateCall.response.output);
  if (!gate) return { ok: false, reason: 'INVALID_GATE_OUTPUT', attempts: 1 };

  if (!gate.buyer_side) {
    return successfulResult({ is_commerce: false, event_type: 'OTHER' }, gate, gateCall.response.model_digest.toLowerCase(), 1);
  }

  const eventCall = await callRuntime('/v1/eventmind', buildBuyerEventPromptV14(document), config, fetchImpl);
  if (!eventCall.ok) {
    return { ok: false, reason: eventCall.reason as EventMindV14Result extends { ok: false; reason: infer R } ? R : never, detail: eventCall.detail, gate, attempts: 2 };
  }
  const decoded = decodeEventMindPredictionV1(eventCall.response.output);
  if (!decoded.ok) {
    return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: decoded.reason, gate, attempts: 2 };
  }
  return successfulResult(decoded.prediction, gate, eventCall.response.model_digest.toLowerCase(), 2);
}
