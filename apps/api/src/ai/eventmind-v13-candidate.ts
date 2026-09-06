import type { NormalizedEmailDocumentV1 } from '../email/document-v1.js';
import type { SemanticEventOverride } from '../purchase-identity-v2/extraction-v2-adapter.js';
import { semanticEventOverrideFromPrediction } from '../purchase-identity-v2/semantic-event-overlay.js';
import {
  buildEventMindInputV1,
  decodeEventMindPredictionV1,
  EVENTMIND_EVENT_TYPES,
  type EventMindPredictionV1,
} from './eventmind-v1.js';
import {
  EVENTMIND_V11_MODEL_ID,
  EVENTMIND_V11_RUNTIME_PROTOCOL,
  EVENTMIND_V11_RUNTIME_VERSION,
  EVENTMIND_V11_TEMPLATE_VERSION,
  EVENTMIND_V11_MAX_NEW_TOKENS,
  eventMindV11RuntimeConfigFromEnvironment,
  type EventMindV11RuntimeConfig,
} from './eventmind-v11-runtime.js';

export const EVENTMIND_V13_SOURCE_ID = 'qwen3-8b-buyflow-v13-candidate' as const;
export const EVENTMIND_V13_SOURCE_VERSION = 'eventmind-v13-prompt-v4-decision-gate-memory-safe' as const;
export const EVENTMIND_V13_PROMPT_VERSION = 'real120-decision-gate-v4-memory-safe' as const;
export const EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS = 12_000 as const;

/**
 * V13 prompt-v4 keeps the memory-safe input boundary but changes the semantic
 * instruction from a few targeted exceptions into a compact decision procedure.
 * REAL120 showed that sender/courier keywords were overpowering buyer-side role,
 * and that several adjacent lifecycle states lacked explicit boundaries.
 * The model still returns only the fixed two-key JSON contract and receives no
 * Purchase candidates or identity authority.
 */
export const EVENTMIND_V13_INSTRUCTION = [
  'Classify exactly one CURRENT BUYER-SIDE purchase lifecycle event from this MailLens EventMind view. Use the decision rules below silently; output no explanation.',
  `event_type must be exactly one of: ${EVENTMIND_EVENT_TYPES.join(', ')}.`,
  'SCOPE GATE: first decide whether the email is actually about the mailbox owner as a BUYER. If it is merchant/seller/outbound operation, courier pickup or collection of goods the mailbox owner is SENDING, business fulfillment, shipping-service administration, marketing, survey, account/security or other non-purchase content, choose OTHER. Exception: an explicit return of the mailbox owner purchase is RETURN. Courier/order/shipment words alone do not make an email buyer-commerce.',
  'CURRENT EVENT RULE: classify the primary current status asserted by this email. Subject and direct current-status statements outrank incidental mentions, instructions, examples, footers and older/history states. Do not jump to a later stage that is only planned or possible.',
  'ORDER_CREATED = buyer order received/confirmed/accepted, with no later processing state. ORDER_PROCESSING = order is being processed/prepared. ORDER_PACKING = order is being packed/packed/ready for dispatch but not yet physically dispatched.',
  'SHIPMENT_CREATED = shipment/tracking/label/consignment was created, registered or pre-advised, but there is no evidence of physical handoff. SHIPPED = explicit evidence the parcel was actually dispatched, sent or physically handed/accepted by the carrier. IN_TRANSIT = after handoff, the parcel is moving through the carrier network, but is not yet on final delivery. OUT_FOR_DELIVERY = the carrier/courier says final delivery to the buyer is happening today/currently. READY_FOR_PICKUP = the parcel is physically available and waiting for the buyer at a locker, parcel shop, pickup point or store. DELIVERED = delivery or buyer collection is completed. DELIVERY_FAILED = a delivery attempt failed. DELAYED = an explicit shipment/delivery delay or postponement.',
  'PAYMENT = the email primary event is a successful/confirmed/charged payment. INVOICE = the primary event is an invoice/receipt document being issued, sent or made available. If an invoice email merely says it is already paid, choose INVOICE; if a payment confirmation merely links to an invoice, choose PAYMENT.',
  'CANCELLED = order/service cancellation is the primary event. REFUNDED = money was actually refunded/returned. RETURN = buyer return process/request/return shipment for a purchase. WARRANTY = warranty/guarantee claim or warranty lifecycle event. If none of the buyer-side lifecycle definitions is positively supported, choose OTHER.',
  'Identifiers, sender identity and presence of tracking/order numbers are evidence context, not lifecycle states. You have no authority to create, link, merge, select or identify a Purchase.',
  'First choose event_type. Then set is_commerce=false only when event_type is OTHER; set is_commerce=true for every other allowed event.',
  'Return JSON only with exactly two keys: is_commerce and event_type. Example shape only: {"is_commerce":true,"event_type":"SHIPPED"}.',
].join(' ');

export function buildEventMindPromptV13(document: NormalizedEmailDocumentV1): string {
  const baseInput = buildEventMindInputV1(document);
  const sourceSemanticText = baseInput.semanticText;
  const semanticText = sourceSemanticText === null
    ? null
    : sourceSemanticText.slice(0, EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS);
  const input = {
    ...baseInput,
    semanticText,
    semanticTextTruncated: baseInput.semanticTextTruncated
      || (sourceSemanticText?.length ?? 0) > EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS,
  };
  return `${EVENTMIND_V13_INSTRUCTION}\n\nEVENTMIND_EMAIL_VIEW:\n${JSON.stringify(input)}`;
}

interface RuntimeResponse {
  protocol_version: typeof EVENTMIND_V11_RUNTIME_PROTOCOL;
  model_id: string;
  adapter_sha256: string;
  runtime_version: string;
  template_version: string;
  thinking_enabled: boolean;
  deterministic: boolean;
  output: string;
}

export type EventMindV13Result =
  | {
      ok: true;
      prediction: EventMindPredictionV1;
      override: SemanticEventOverride;
      runtime: {
        modelId: string;
        adapterSha256: string;
        runtimeVersion: string;
        templateVersion: string;
        promptVersion: typeof EVENTMIND_V13_PROMPT_VERSION;
        thinkingEnabled: false;
        deterministic: true;
        attempts: 1;
      };
    }
  | {
      ok: false;
      reason:
        | 'RUNTIME_DISABLED'
        | 'RUNTIME_UNAVAILABLE'
        | 'RUNTIME_TIMEOUT'
        | 'RUNTIME_HTTP_ERROR'
        | 'INVALID_RUNTIME_RESPONSE'
        | 'RUNTIME_METADATA_MISMATCH'
        | 'INVALID_MODEL_OUTPUT';
      detail?: string;
      attempts: 0 | 1;
    };

function runtimeResponse(value: unknown): RuntimeResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    'adapter_sha256', 'deterministic', 'model_id', 'output', 'protocol_version',
    'runtime_version', 'template_version', 'thinking_enabled',
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  if (
    record.protocol_version !== EVENTMIND_V11_RUNTIME_PROTOCOL
    || typeof record.model_id !== 'string'
    || typeof record.adapter_sha256 !== 'string'
    || typeof record.runtime_version !== 'string'
    || typeof record.template_version !== 'string'
    || typeof record.thinking_enabled !== 'boolean'
    || typeof record.deterministic !== 'boolean'
    || typeof record.output !== 'string'
  ) return null;
  return record as unknown as RuntimeResponse;
}

function metadataMatches(response: RuntimeResponse, config: Extract<EventMindV11RuntimeConfig, { enabled: true }>): boolean {
  return response.model_id === EVENTMIND_V11_MODEL_ID
    && response.adapter_sha256.toLowerCase() === config.expectedAdapterSha256
    && response.runtime_version === EVENTMIND_V11_RUNTIME_VERSION
    && response.template_version === EVENTMIND_V11_TEMPLATE_VERSION
    && response.thinking_enabled === false
    && response.deterministic === true;
}

/**
 * Single-attempt by design, matching the stable V11 request behavior. Model
 * quality failures and runtime timeouts remain visible instead of being hidden
 * by repeated inference on a busy local GPU.
 */
export async function runEventMindV13(
  document: NormalizedEmailDocumentV1,
  config: EventMindV11RuntimeConfig = eventMindV11RuntimeConfigFromEnvironment(),
  fetchImpl: typeof fetch = fetch,
): Promise<EventMindV13Result> {
  if (!config.enabled) return { ok: false, reason: 'RUNTIME_DISABLED', attempts: 0 };
  const prompt = buildEventMindPromptV13(document);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: EVENTMIND_V11_RUNTIME_PROTOCOL,
        prompt,
        generation: {
          do_sample: false,
          enable_thinking: false,
          max_new_tokens: EVENTMIND_V11_MAX_NEW_TOKENS,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: 'RUNTIME_HTTP_ERROR', detail: `HTTP ${response.status}`, attempts: 1 };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      if (controller.signal.aborted) return { ok: false, reason: 'RUNTIME_TIMEOUT', attempts: 1 };
      return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE', attempts: 1 };
    }

    const runtime = runtimeResponse(parsed);
    if (!runtime) return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE', attempts: 1 };
    if (!metadataMatches(runtime, config)) {
      return { ok: false, reason: 'RUNTIME_METADATA_MISMATCH', attempts: 1 };
    }

    const decoded = decodeEventMindPredictionV1(runtime.output);
    if (!decoded.ok) {
      return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: decoded.reason, attempts: 1 };
    }
    const semantic = semanticEventOverrideFromPrediction({
      eventType: decoded.prediction.event_type,
      isCommerce: decoded.prediction.is_commerce,
    }, {
      sourceId: EVENTMIND_V13_SOURCE_ID,
      sourceVersion: EVENTMIND_V13_SOURCE_VERSION,
    });
    if (!semantic.ok) {
      return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: semantic.reason, attempts: 1 };
    }

    return {
      ok: true,
      prediction: decoded.prediction,
      override: semantic.override,
      runtime: {
        modelId: runtime.model_id,
        adapterSha256: runtime.adapter_sha256.toLowerCase(),
        runtimeVersion: runtime.runtime_version,
        templateVersion: runtime.template_version,
        promptVersion: EVENTMIND_V13_PROMPT_VERSION,
        thinkingEnabled: false,
        deterministic: true,
        attempts: 1,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: 'RUNTIME_TIMEOUT', attempts: 1 };
    return {
      ok: false,
      reason: 'RUNTIME_UNAVAILABLE',
      detail: error instanceof Error ? error.message : 'runtime request failed',
      attempts: 1,
    };
  } finally {
    clearTimeout(timer);
  }
}
