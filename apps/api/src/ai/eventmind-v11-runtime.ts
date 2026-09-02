import type { NormalizedEmailDocumentV1 } from '../email/document-v1.js';
import type { SemanticEventOverride } from '../purchase-identity-v2/extraction-v2-adapter.js';
import {
  buildEventMindInputV1,
  buildEventMindPromptV1,
  decodeEventMindPredictionV1,
  eventMindSemanticOverrideFromV1,
  type EventMindPredictionV1,
} from './eventmind-v1.js';

export const EVENTMIND_V11_MODEL_ID = 'Qwen/Qwen3-8B' as const;
export const EVENTMIND_V11_RUNTIME_PROTOCOL = 'buyflow-eventmind-v11-runtime-v1' as const;
export const EVENTMIND_V11_RUNTIME_VERSION = 'eventmind-v11-runtime-v1' as const;
export const EVENTMIND_V11_TEMPLATE_VERSION = 'qwen3-chat-template-thinking-off-v1' as const;
export const EVENTMIND_V11_MAX_NEW_TOKENS = 48 as const;

const SHA256 = /^[a-f0-9]{64}$/i;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;

export type EventMindV11RuntimeConfig =
  | { enabled: false }
  | {
      enabled: true;
      endpoint: string;
      expectedAdapterSha256: string;
      expectedModelId: typeof EVENTMIND_V11_MODEL_ID;
      expectedRuntimeVersion: typeof EVENTMIND_V11_RUNTIME_VERSION;
      expectedTemplateVersion: typeof EVENTMIND_V11_TEMPLATE_VERSION;
      timeoutMs: number;
    };

export type EventMindV11RuntimeFailureReason =
  | 'RUNTIME_DISABLED'
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_TIMEOUT'
  | 'RUNTIME_HTTP_ERROR'
  | 'INVALID_RUNTIME_RESPONSE'
  | 'RUNTIME_METADATA_MISMATCH'
  | 'INVALID_MODEL_OUTPUT';

export type EventMindV11RuntimeResult =
  | {
      ok: true;
      prediction: EventMindPredictionV1;
      override: SemanticEventOverride;
      runtime: {
        modelId: string;
        adapterSha256: string;
        runtimeVersion: string;
        templateVersion: string;
        thinkingEnabled: false;
        deterministic: true;
      };
    }
  | {
      ok: false;
      reason: EventMindV11RuntimeFailureReason;
      detail?: string;
    };

interface EventMindV11RuntimeResponseV1 {
  protocol_version: typeof EVENTMIND_V11_RUNTIME_PROTOCOL;
  model_id: string;
  adapter_sha256: string;
  runtime_version: string;
  template_version: string;
  thinking_enabled: boolean;
  deterministic: boolean;
  output: string;
}

function enabledFlag(value: string | undefined): boolean {
  return value === 'true';
}

function runtimeEndpoint(value: string | undefined): string {
  if (!value) throw new Error('EventMind V11 runtime URL is missing');
  const url = new URL(value);
  const localHttp = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('EventMind V11 runtime URL must use HTTPS or loopback HTTP');
  }
  url.hash = '';
  url.search = '';
  return url.toString();
}

function timeoutMs(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 250 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`EventMind V11 timeout must be an integer between 250 and ${MAX_TIMEOUT_MS} ms`);
  }
  return parsed;
}

/**
 * EventMind stays disabled unless explicitly enabled. Enabling it requires the
 * exact local V11 adapter SHA-256; there is intentionally no guessed/default SHA.
 */
export function eventMindV11RuntimeConfigFromEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): EventMindV11RuntimeConfig {
  if (!enabledFlag(source.BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED)) {
    return { enabled: false };
  }

  const adapterSha = source.BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256?.trim().toLowerCase();
  if (!adapterSha || !SHA256.test(adapterSha)) {
    throw new Error('EventMind V11 requires BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 as an exact SHA-256 pin');
  }

  return {
    enabled: true,
    endpoint: runtimeEndpoint(source.BUYFLOW_EVENTMIND_V11_RUNTIME_URL),
    expectedAdapterSha256: adapterSha,
    expectedModelId: EVENTMIND_V11_MODEL_ID,
    expectedRuntimeVersion: EVENTMIND_V11_RUNTIME_VERSION,
    expectedTemplateVersion: EVENTMIND_V11_TEMPLATE_VERSION,
    timeoutMs: timeoutMs(source.BUYFLOW_EVENTMIND_V11_TIMEOUT_MS),
  };
}

function runtimeResponse(value: unknown): EventMindV11RuntimeResponseV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    'adapter_sha256',
    'deterministic',
    'model_id',
    'output',
    'protocol_version',
    'runtime_version',
    'template_version',
    'thinking_enabled',
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null;
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
  return record as unknown as EventMindV11RuntimeResponseV1;
}

function metadataMatches(
  response: EventMindV11RuntimeResponseV1,
  config: Extract<EventMindV11RuntimeConfig, { enabled: true }>,
): boolean {
  return response.model_id === config.expectedModelId
    && response.adapter_sha256.toLowerCase() === config.expectedAdapterSha256
    && response.runtime_version === config.expectedRuntimeVersion
    && response.template_version === config.expectedTemplateVersion
    && response.thinking_enabled === false
    && response.deterministic === true;
}

/**
 * Calls the pinned V11 classifier in a fail-closed way. The request contains
 * only the MailLens-derived EventMind prompt and fixed deterministic generation
 * settings. No Purchase candidates or identity graph state are accepted here.
 */
export async function runEventMindV11(
  document: NormalizedEmailDocumentV1,
  config: EventMindV11RuntimeConfig = eventMindV11RuntimeConfigFromEnvironment(),
  fetchImpl: typeof fetch = fetch,
): Promise<EventMindV11RuntimeResult> {
  if (!config.enabled) return { ok: false, reason: 'RUNTIME_DISABLED' };

  const input = buildEventMindInputV1(document);
  const prompt = buildEventMindPromptV1(input);
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
      return { ok: false, reason: 'RUNTIME_HTTP_ERROR', detail: `HTTP ${response.status}` };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      if (controller.signal.aborted) return { ok: false, reason: 'RUNTIME_TIMEOUT' };
      return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE' };
    }

    const runtime = runtimeResponse(parsed);
    if (!runtime) return { ok: false, reason: 'INVALID_RUNTIME_RESPONSE' };
    if (!metadataMatches(runtime, config)) {
      return { ok: false, reason: 'RUNTIME_METADATA_MISMATCH' };
    }

    const decoded = decodeEventMindPredictionV1(runtime.output);
    if (!decoded.ok) {
      return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: decoded.reason };
    }
    const semantic = eventMindSemanticOverrideFromV1(decoded.prediction);
    if (!semantic.ok) {
      return { ok: false, reason: 'INVALID_MODEL_OUTPUT', detail: semantic.reason };
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
        thinkingEnabled: false,
        deterministic: true,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, reason: 'RUNTIME_TIMEOUT' };
    return {
      ok: false,
      reason: 'RUNTIME_UNAVAILABLE',
      detail: error instanceof Error ? error.message : 'runtime request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}
