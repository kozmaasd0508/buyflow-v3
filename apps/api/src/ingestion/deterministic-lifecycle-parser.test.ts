import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';

test('parses Gyerekjatekbolt failed payment', () => {
  const result = parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], subject: 'Sikertelen bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!', bodyText: 'A(z) 535574. számú rendelést NEM sikerült befizetnie.' });
  assert.ok(result); assert.equal(result.lifecycleEvent, 'payment_failed'); assert.equal(result.extraction.order_number, '535574'); assert.equal(result.extraction.payment_status, 'failed');
});

test('parses explicit Gyerekjatekbolt cancellation', () => {
  const result = parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], subject: 'A rendelés állapota megváltozott', bodyText: 'Rendelésszám: 535574 Jelenlegi állapot: Törölve' });
  assert.ok(result); assert.equal(result.lifecycleEvent, 'cancelled'); assert.equal(result.extraction.order_number, '535574');
});

test('parses real Marketa warehouse packing as order_packing, never shipment', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['marketa.hu'],
    subject: '✅ Marketa.hu - 1140165 rendelés - Jó hír! Elkezdtük rendelésed összekészítését! - Megrendelésedet elfogadtuk',
    bodyText: 'A Marketa.hu oldalon keresztül leadott, 1140165 számú rendeléseddel kapcsolatos fontos információ: Örömmel értesítünk, hogy rendelésedet elfogadtuk és raktárunk már elkezdte becsomagolni. Várhatóan raktárunk 1-2 munkanapon belül átadja azt a futárszolgálatnak, amiről emailben ismét értesíteni fogunk.',
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'order_packing');
  assert.equal(result.extraction.event_type, 'order_updated');
  assert.equal(result.extraction.merchant, 'Marketa.hu');
  assert.equal(result.extraction.order_number, '1140165');
  assert.equal(result.extraction.tracking_number, null);
});

test('Marketa packing requires exact sender and explicit future courier handoff', () => {
  const subject = 'Marketa.hu - 1140165 rendelés - Elkezdtük rendelésed összekészítését!';
  const body = '1140165 számú rendeléseddel kapcsolatban raktárunk már elkezdte becsomagolni.';
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['marketa.hu'], subject, bodyText: body }), null);
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['marketa.hu.attacker.com'], subject, bodyText: `${body} Várhatóan raktárunk 1-2 munkanapon belül átadja azt a futárszolgálatnak.` }), null);
});
