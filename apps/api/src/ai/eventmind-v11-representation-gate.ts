import {
  EVENTMIND_EVENT_TYPES,
  type EventMindEventType,
  type EventMindPredictionV1,
} from './eventmind-v1.js';

export const EVENTMIND_REUSED_FIXTURE_SHA256 = new Set([
  // V11 Fresh Blind v1 / later SemanticEmailView A/B diagnostic: already viewed.
  '6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251',
]);

export interface EventMindRepresentationGateCaseResult {
  caseId: string;
  expected: EventMindPredictionV1;
  prediction: EventMindPredictionV1 | null;
  error: string | null;
}

export interface EventMindRepresentationGateScore {
  gate: 'PASS' | 'FAIL';
  total: number;
  exactCorrect: number;
  exactAccuracy: number;
  macroEventAccuracy: number;
  invalidOutputCount: number;
  incoherentOutputCount: number;
  unsafePromotionCount: number;
  otherFalseCommerceCount: number;
  all18EventsPresent: boolean;
  perEvent: Record<EventMindEventType, { correct: number; total: number; accuracy: number }>;
}

const UNSAFE_PROMOTIONS: Partial<Record<EventMindEventType, ReadonlySet<EventMindEventType>>> = {
  ORDER_PACKING: new Set(['SHIPMENT_CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED']),
  SHIPMENT_CREATED: new Set(['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED']),
  SHIPPED: new Set(['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED']),
  IN_TRANSIT: new Set(['OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED']),
  OUT_FOR_DELIVERY: new Set(['DELIVERED']),
  READY_FOR_PICKUP: new Set(['DELIVERED']),
  RETURN: new Set(['REFUNDED']),
  CANCELLED: new Set(['REFUNDED']),
};

export function assertUntouchedEventMindRepresentationFixture(input: {
  sha256: string;
  caseCount: number;
  eventTypes: Iterable<EventMindEventType>;
}): void {
  const hash = input.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('EVENTMIND_GATE_FIXTURE_HASH_INVALID');
  if (EVENTMIND_REUSED_FIXTURE_SHA256.has(hash)) throw new Error('EVENTMIND_GATE_FIXTURE_ALREADY_USED');
  if (input.caseCount < 90) throw new Error('EVENTMIND_GATE_FIXTURE_TOO_SMALL');
  const present = new Set(input.eventTypes);
  for (const eventType of EVENTMIND_EVENT_TYPES) {
    if (!present.has(eventType)) throw new Error(`EVENTMIND_GATE_EVENT_MISSING:${eventType}`);
  }
}

export function scoreEventMindRepresentationGate(
  rows: EventMindRepresentationGateCaseResult[],
): EventMindRepresentationGateScore {
  const counters = Object.fromEntries(EVENTMIND_EVENT_TYPES.map((eventType) => [
    eventType,
    { correct: 0, total: 0, accuracy: 0 },
  ])) as Record<EventMindEventType, { correct: number; total: number; accuracy: number }>;

  let exactCorrect = 0;
  let invalidOutputCount = 0;
  let incoherentOutputCount = 0;
  let unsafePromotionCount = 0;
  let otherFalseCommerceCount = 0;

  for (const row of rows) {
    const counter = counters[row.expected.event_type];
    counter.total += 1;
    if (row.error || !row.prediction) {
      invalidOutputCount += 1;
      continue;
    }
    const prediction = row.prediction;
    if (prediction.is_commerce !== (prediction.event_type !== 'OTHER')) incoherentOutputCount += 1;
    if (row.expected.event_type === 'OTHER' && prediction.is_commerce) otherFalseCommerceCount += 1;
    if (UNSAFE_PROMOTIONS[row.expected.event_type]?.has(prediction.event_type)) unsafePromotionCount += 1;
    if (
      prediction.is_commerce === row.expected.is_commerce
      && prediction.event_type === row.expected.event_type
    ) {
      exactCorrect += 1;
      counter.correct += 1;
    }
  }

  const total = rows.length;
  const eventAccuracies: number[] = [];
  for (const eventType of EVENTMIND_EVENT_TYPES) {
    const counter = counters[eventType];
    counter.accuracy = counter.total > 0 ? counter.correct / counter.total : 0;
    eventAccuracies.push(counter.accuracy);
  }
  const exactAccuracy = total > 0 ? exactCorrect / total : 0;
  const macroEventAccuracy = eventAccuracies.reduce((sum, value) => sum + value, 0) / EVENTMIND_EVENT_TYPES.length;
  const all18EventsPresent = EVENTMIND_EVENT_TYPES.every((eventType) => counters[eventType].total > 0);
  const pass = total >= 90
    && all18EventsPresent
    && invalidOutputCount === 0
    && incoherentOutputCount === 0
    && unsafePromotionCount === 0
    && otherFalseCommerceCount === 0
    && exactAccuracy >= 0.90
    && macroEventAccuracy >= 0.85;

  return {
    gate: pass ? 'PASS' : 'FAIL',
    total,
    exactCorrect,
    exactAccuracy,
    macroEventAccuracy,
    invalidOutputCount,
    incoherentOutputCount,
    unsafePromotionCount,
    otherFalseCommerceCount,
    all18EventsPresent,
    perEvent: counters,
  };
}
