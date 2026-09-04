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
export const EVENTMIND_V13_SOURCE_VERSION = 'eventmind-v13-prompt-v3-lite-memory-safe' as const;
export const EVENTMIND_V13_PROMPT_VERSION = 'real120-targeted-lite-v3-memory-safe' as const;
export const EVENTMIND_V13_MAX_SEMANTIC_TEXT_CHARS = 12_000 as const;

/**
 * V13-lite intentionally stays close to the short V11 prompt. REAL120 exposed
 * three concrete taxonomy gaps, so only those gaps are added here. This avoids
 * the much longer all-taxonomy prompt used by the first V13 experiment, which
 * increased local GPU pressure and triggered a timeout cascade on the user's PC.
 */
export const EVENTMIND_V13_INSTRUCTION = [
  'Classify the latest concrete BUYER-SIDE commerce lifecycle state from this MailLens EventMind view.',
  `event_type must be exactly one of: ${EVENTMIND_EVENT_TYPES.join(', ')}.`,
  'Courier pickup/collection emails about goods the mailbox owner is SENDING are OTHER, unless they explicitly describe returning a purchase.',
  'SHIPPED means the parcel was actually dispatched or handed to the carrier; a pre-advice/tracking record before physical handoff is SHIPMENT_CREATED.',
  'READY_FOR_PICKUP means the parcel is available for the buyer at a locker, parcel shop, pickup point or store; it is not DELIVERED until the buyer receives it.',
  'Identifiers are not lifecycle states. You have no authority to create, link, merge, select or identify a Purchase.',
  'Return JSON only with exactly two keys: is_commerce and event_type.',
  'is_commerce must be false exactly when event_type is OTHER, otherwise true.',
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
