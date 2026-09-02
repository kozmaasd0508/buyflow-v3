import type {
  EmailStructuredDataRecord,
  NormalizedEmailDocumentV1,
} from '../email/document-v1.js';
import {
  SEMANTIC_EVENT_TYPES,
  semanticEventOverrideFromPrediction,
  type SemanticEventType,
  type SemanticOverlayResult,
} from '../purchase-identity-v2/semantic-event-overlay.js';

export const EVENTMIND_INPUT_VERSION = 'eventmind-mail-lens-v1' as const;
export const EVENTMIND_DECODER_VERSION = 'eventmind-decoder-v1' as const;
export const EVENTMIND_SOURCE_ID = 'qwen3-8b-buyflow-v11' as const;
export const EVENTMIND_EVENT_TYPES = SEMANTIC_EVENT_TYPES;

export type EventMindEventType = SemanticEventType;

export interface EventMindStructuredHintV1 {
  kind: EmailStructuredDataRecord['kind'];
  schemaType: string | null;
  normalization: EmailStructuredDataRecord['normalization'] | null;
  payload: unknown;
}

export interface EventMindInputV1 {
  viewVersion: typeof EVENTMIND_INPUT_VERSION;
  subject: string | null;
  from: Array<{ email: string; name?: string }>;
  receivedAt: string;
  semanticText: string | null;
  semanticTextTruncated: boolean;
  quotedHistoryDetected: boolean;
  structuredData: EventMindStructuredHintV1[];
}

export interface EventMindPredictionV1 {
  is_commerce: boolean;
  event_type: EventMindEventType;
}

export type EventMindDecodeResultV1 =
  | { ok: true; prediction: EventMindPredictionV1 }
  | {
      ok: false;
      reason:
        | 'INVALID_JSON'
        | 'INVALID_SCHEMA'
        | 'INVALID_VALUES'
        | 'COMMERCE_INVARIANT_MISMATCH';
    };

const VALID_EVENTS = new Set<string>(EVENTMIND_EVENT_TYPES);
const MAX_STRUCTURED_RECORDS = 8;
const MAX_STRUCTURED_DEPTH = 6;
const MAX_STRUCTURED_ARRAY_ITEMS = 16;
const MAX_STRUCTURED_OBJECT_KEYS = 32;
const MAX_STRUCTURED_STRING_CHARS = 2_000;

const FORBIDDEN_STRUCTURED_KEYS = new Set([
  'id',
  'identifier',
  'serialnumber',
  'purchaseid',
  'purchaseids',
  'candidateid',
  'candidateids',
  'candidatepurchaseid',
  'candidatepurchaseids',
  'ordernumber',
  'orderid',
  'trackingnumber',
  'trackingid',
  'shipmentnumber',
  'shipmentid',
  'invoicenumber',
  'invoiceid',
  'paymentreference',
  'paymentid',
  'merchantid',
  'carrierid',
  'providermessageid',
  'providerthreadid',
  'rawref',
  'traceid',
  'href',
  'url',
  'orderurl',
  'trackingurl',
  'invoiceurl',
  'paymenturl',
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isIdentityBearingStructuredKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (FORBIDDEN_STRUCTURED_KEYS.has(normalized)) return true;
  if (/(?:url|href)$/.test(normalized)) return true;
  return /(?:purchase|candidate|order|tracking|shipment|invoice|payment|merchant|carrier)(?:id|ids|number|numbers|reference|references|code|codes|token|tokens)$/.test(normalized);
}

function sanitizeStructuredValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_STRUCTURED_DEPTH) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRUCTURED_STRING_CHARS);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_STRUCTURED_ARRAY_ITEMS)
      .map((item) => sanitizeStructuredValue(item, depth + 1));
  }
  if (typeof value !== 'object') return null;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, MAX_STRUCTURED_OBJECT_KEYS)) {
    if (isIdentityBearingStructuredKey(key)) continue;
    output[key] = sanitizeStructuredValue(nested, depth + 1);
  }
  return output;
}

function structuredHint(record: EmailStructuredDataRecord): EventMindStructuredHintV1 {
  return {
    kind: record.kind,
    schemaType: record.schemaType ?? null,
    normalization: record.normalization ?? null,
    payload: sanitizeStructuredValue(record.payload),
  };
}

/**
 * The only production-side model input projection for EventMind.
 *
 * It consumes an already-normalized MailLens document and therefore never
 * re-normalizes provider body/HTML itself. Full body evidence, quoted history,
 * raw HTML, provider ids, recipients, headers/authentication, folders, links,
 * attachments, raw archive references and trace ids are deliberately omitted.
 *
 * Structured payloads are retained only as bounded lifecycle hints with common
 * identity-bearing keys removed. Purchase candidates/internal Purchase ids are
 * not part of this contract.
 */
export function buildEventMindInputV1(
  document: NormalizedEmailDocumentV1,
): EventMindInputV1 {
  return {
    viewVersion: EVENTMIND_INPUT_VERSION,
    subject: document.subject,
    from: document.from.map((sender) => ({
      email: sender.email,
      ...(sender.name ? { name: sender.name } : {}),
    })),
    receivedAt: document.receivedAt,
    semanticText: document.semanticText,
    semanticTextTruncated: document.normalization.semanticTextTruncated,
    quotedHistoryDetected: document.normalization.quotedHistoryDetected,
    structuredData: document.structuredData
      .slice(0, MAX_STRUCTURED_RECORDS)
      .map(structuredHint),
  };
}

export const EVENTMIND_INSTRUCTION_V1 = [
  'Classify the latest concrete commerce lifecycle state from this MailLens EventMind view.',
  'Use the current semantic text and bounded structured lifecycle hints; stale quoted history is not part of the view.',
  'Identifiers are not lifecycle states.',
  'You have no authority to create, link, merge, select or identify a Purchase and must never output Purchase/candidate/order/tracking/invoice/payment identity fields.',
  'Return JSON only with exactly two keys: is_commerce and event_type.',
].join(' ');

export function buildEventMindPromptV1(input: EventMindInputV1): string {
  return `${EVENTMIND_INSTRUCTION_V1}\n\nEVENTMIND_EMAIL_VIEW:\n${JSON.stringify(input)}`;
}

function parseObject(raw: string | unknown): Record<string, unknown> | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw.trim());
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Strict fail-closed decoder for Qwen/V11 output. Extra keys are rejected rather
 * than ignored, so an attempted identity field invalidates the whole response.
 */
export function decodeEventMindPredictionV1(raw: string | unknown): EventMindDecodeResultV1 {
  const object = parseObject(raw);
  if (!object) return { ok: false, reason: typeof raw === 'string' ? 'INVALID_JSON' : 'INVALID_SCHEMA' };

  const keys = Object.keys(object).sort();
  if (keys.length !== 2 || keys[0] !== 'event_type' || keys[1] !== 'is_commerce') {
    return { ok: false, reason: 'INVALID_SCHEMA' };
  }

  if (typeof object.is_commerce !== 'boolean' || typeof object.event_type !== 'string') {
    return { ok: false, reason: 'INVALID_VALUES' };
  }

  if (!VALID_EVENTS.has(object.event_type)) {
    return { ok: false, reason: 'INVALID_VALUES' };
  }

  const eventType = object.event_type as EventMindEventType;
  const expectedCommerce = eventType !== 'OTHER';
  if (object.is_commerce !== expectedCommerce) {
    return { ok: false, reason: 'COMMERCE_INVARIANT_MISMATCH' };
  }

  return {
    ok: true,
    prediction: {
      is_commerce: object.is_commerce,
      event_type: eventType,
    },
  };
}

/**
 * Converts a successfully decoded EventMind result to the same semantic-only
 * Identity Graph override contract used by previous Qwen generations.
 */
export function eventMindSemanticOverrideFromV1(
  prediction: EventMindPredictionV1,
): SemanticOverlayResult {
  return semanticEventOverrideFromPrediction({
    eventType: prediction.event_type,
    isCommerce: prediction.is_commerce,
  }, {
    sourceId: EVENTMIND_SOURCE_ID,
    sourceVersion: EVENTMIND_DECODER_VERSION,
  });
}
