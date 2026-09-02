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
export const EVENTMIND_V13_SOURCE_VERSION = 'eventmind-v13-prompt-v1' as const;
export const EVENTMIND_V13_PROMPT_VERSION = 'buyer-lifecycle-explicit-taxonomy-v1' as const;

const RETRYABLE_HTTP = new Set([500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

export const EVENTMIND_V13_INSTRUCTION = [
  'Classify the latest concrete BUYER-SIDE commerce lifecycle state from this MailLens EventMind view.',
  'The mailbox owner is the buyer. Operational courier collection or pickup-request emails about goods the mailbox owner is SENDING are not a buyer purchase lifecycle event: classify OTHER, unless the email explicitly describes returning a purchase, then classify RETURN.',
  `event_type MUST be exactly one of: ${EVENTMIND_EVENT_TYPES.join(', ')}. Never invent, translate, shorten or paraphrase a label.`,
  'Use these distinctions strictly:',
  'ORDER_CREATED = the buyer order was placed/accepted/confirmed.',
  'ORDER_PROCESSING = merchant is processing the buyer order but is not yet packing it.',
  'ORDER_PACKING = merchant is packing/preparing the buyer order, or it is packed and waiting for carrier handoff.',
  'SHIPMENT_CREATED = a tracking/pre-advice/shipping record exists but the carrier has NOT physically received the parcel yet.',
  'SHIPPED = merchant or carrier confirms the parcel was dispatched, handed to the carrier, accepted for transport, or physically sent.',
  'IN_TRANSIT = after carrier handoff, the parcel is moving through the carrier network/depot and is not yet out for final delivery.',
  'OUT_FOR_DELIVERY = courier has the parcel for delivery today / final-mile delivery attempt is underway.',
  'READY_FOR_PICKUP = parcel is physically available for the buyer at a locker, parcel shop, pickup point or store. This is NOT DELIVERED.',
  'DELIVERED = parcel was successfully delivered to/received by the buyer. A locker arrival that is merely available for pickup is not DELIVERED.',
  'DELIVERY_FAILED = an attempted delivery failed.',
  'DELAYED = an explicit shipment/order delay is the latest concrete state.',
  'CANCELLED = the order/shipment was cancelled.',
  'REFUNDED = money was explicitly refunded.',
  'PAYMENT = a buyer payment/charge/paid receipt is the latest concrete commerce event.',
  'INVOICE = an invoice was issued/created and that document event is the latest concrete state.',
  'RETURN = a return of a buyer purchase was created/accepted/in progress.',
  'WARRANTY = a warranty claim/service event is the latest concrete state.',
  'OTHER = not a buyer-side purchase lifecycle event, including account/profile/security/subscription welcome messages, generic marketing, data exports, and merchant-side courier pickup operations.',
  'Prefer the latest concrete state in the current semantic text. Do not infer a later state from expected/future wording.',
  'Identifiers are not lifecycle states. You have no authority to create, link, merge, select or identify a Purchase.',
  'Return JSON only, exactly two keys and no markdown: {"is_commerce":true,"event_type":"SHIPPED"}.',
  'is_commerce MUST be false if and only if event_type is OTHER; otherwise it MUST be true.',
].join(' ');

export function buildEventMindPromptV13(document: NormalizedEmailDocumentV1): string {
  const input = buildEventMindInputV1(document);
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
        attempts: number;
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
      attempts: number;
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

function retryDelay(attempt: number): Promise<void> {
  const ms = attempt === 1 ? 250 : 750;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runEventMindV13(
  document: NormalizedEmailDocumentV1,
  config: EventMindV11RuntimeConfig = eventMindV11RuntimeConfigFromEnvironment(),
  fetchImpl: typeof fetch = fetch,
): Promise<EventMindV13Result> {
  if (!config.enabled) return { ok: false, reason: 'RUNTIME_DISABLED', attempts: 0 };
  const prompt = buildEventMindPromptV13(document);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
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
        if (RETRYABLE_HTTP.has(response.status) && attempt < MAX_ATTEMPTS) {
          await retryDelay(attempt);
          continue;
        }
        return { ok: false, reason: 'RUNTIME_HTTP_ERROR', detail: `HTTP ${response.status}`, attempts: attempt };
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE', attempts: attempt };
      }
      const runtime = runtimeResponse(parsed);
      if (!runtime) return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE', attempts: attempt };
      if (!metadataMatches(runtime, config)) {
        return { ok: false, reason: 'RUNTIME_METADATA_MISMATCH', attempts: attempt };
      }

      const decoded = decodeEventMindPredictionV1(runtime.output);
      if (!decoded.ok) {
        return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: decoded.reason, attempts: attempt };
      }
      const semantic = semanticEventOverrideFromPrediction({
        eventType: decoded.prediction.event_type,
        isCommerce: decoded.prediction.is_commerce,
      }, {
        sourceId: EVENTMIND_V13_SOURCE_ID,
        sourceVersion: EVENTMIND_V13_SOURCE_VERSION,
      });
      if (!semantic.ok) {
        return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: semantic.reason, attempts: attempt };
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
          attempts: attempt,
        },
      };
    } catch (error) {
      if (controller.signal.aborted) {
        if (attempt < MAX_ATTEMPTS) {
          await retryDelay(attempt);
          continue;
        }
        return { ok: false, reason: 'RUNTIME_TIMEOUT', attempts: attempt };
      }
      if (attempt < MAX_ATTEMPTS) {
        await retryDelay(attempt);
        continue;
      }
      return {
        ok: false,
        reason: 'RUNTIME_UNAVAILABLE',
        detail: error instanceof Error ? error.message : 'runtime request failed',
        attempts: attempt,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: 'RUNTIME_UNAVAILABLE', attempts: MAX_ATTEMPTS };
}
