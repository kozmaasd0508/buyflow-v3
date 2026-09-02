import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENTMIND_EVENT_TYPES, type EventMindPredictionV1 } from './eventmind-v1.js';
import {
  assertUntouchedEventMindRepresentationFixture,
  scoreEventMindRepresentationGate,
  type EventMindRepresentationGateCaseResult,
} from './eventmind-v11-representation-gate.js';

function expected(event_type: EventMindPredictionV1['event_type']): EventMindPredictionV1 {
  return { is_commerce: event_type !== 'OTHER', event_type };
}

function perfectRows(): EventMindRepresentationGateCaseResult[] {
  return EVENTMIND_EVENT_TYPES.flatMap((eventType) => Array.from({ length: 5 }, (_unused, index) => ({
    caseId: `${eventType}-${index + 1}`,
    expected: expected(eventType),
    prediction: expected(eventType),
    error: null,
  })));
}

test('untouched gate rejects the already-viewed 180-case fixture and requires broad 18-event coverage', () => {
  assert.throws(() => assertUntouchedEventMindRepresentationFixture({
    sha256: '6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251',
    caseCount: 180,
    eventTypes: EVENTMIND_EVENT_TYPES,
  }), /ALREADY_USED/);

  assert.throws(() => assertUntouchedEventMindRepresentationFixture({
    sha256: 'b'.repeat(64),
    caseCount: 90,
    eventTypes: EVENTMIND_EVENT_TYPES.filter((eventType) => eventType !== 'OTHER'),
  }), /EVENT_MISSING:OTHER/);

  assert.doesNotThrow(() => assertUntouchedEventMindRepresentationFixture({
    sha256: 'b'.repeat(64),
    caseCount: 90,
    eventTypes: EVENTMIND_EVENT_TYPES,
  }));
});

test('representation gate passes only a clean broad result', () => {
  const score = scoreEventMindRepresentationGate(perfectRows());
  assert.equal(score.total, 90);
  assert.equal(score.exactAccuracy, 1);
  assert.equal(score.macroEventAccuracy, 1);
  assert.equal(score.all18EventsPresent, true);
  assert.equal(score.invalidOutputCount, 0);
  assert.equal(score.unsafePromotionCount, 0);
  assert.equal(score.gate, 'PASS');
});

test('representation gate fails on invalid output or unsafe lifecycle promotion', () => {
  const invalidRows = perfectRows();
  invalidRows[0] = { ...invalidRows[0]!, prediction: null, error: 'INVALID_MODEL_OUTPUT' };
  const invalidScore = scoreEventMindRepresentationGate(invalidRows);
  assert.equal(invalidScore.invalidOutputCount, 1);
  assert.equal(invalidScore.gate, 'FAIL');

  const unsafeRows = perfectRows();
  const packingIndex = unsafeRows.findIndex((row) => row.expected.event_type === 'ORDER_PACKING');
  assert.notEqual(packingIndex, -1);
  unsafeRows[packingIndex] = {
    ...unsafeRows[packingIndex]!,
    prediction: expected('DELIVERED'),
  };
  const unsafeScore = scoreEventMindRepresentationGate(unsafeRows);
  assert.equal(unsafeScore.unsafePromotionCount, 1);
  assert.equal(unsafeScore.gate, 'FAIL');
});
