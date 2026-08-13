import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';

test('parses Gyerekjatekbolt failed payment', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Sikertelen bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!',
    bodyText: 'A(z) 535574. számú rendelést NEM sikerült befizetnie.',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'payment_failed');
  assert.equal(result.extraction.order_number, '535574');
  assert.equal(result.extraction.payment_status, 'failed');
});

test('parses explicit Gyerekjatekbolt cancellation', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'A rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 535574 Jelenlegi állapot: Törölve',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'cancelled');
  assert.equal(result.extraction.order_number, '535574');
});
