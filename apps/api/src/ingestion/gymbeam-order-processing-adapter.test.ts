import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGymBeamOrderProcessingEmail } from './gymbeam-order-processing-adapter.js';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';

const body = `Köszönjük! Megkaptuk a rendelésedet.

Feldolgozás alatt

A 3010085026 számú rendelésed már készül!

Rendelési összesítő:

1x 100% Kreatin-monohidrát - GymBeam
Grammsúly: 250 g, Ízesítés: ízesítetlen
2 790Ft

3x Magnézium shot - GymBeam
Ízesítés: narancs, Kiszerelés (ml): 60 ml
1 170Ft

1x Beam póló Black - GymBeam
Méret: XL
1 990Ft

Szállítás: 1 190Ft
Utánvét: 300Ft
Szállítási mód: Kikézbesítés Express One futárral
Fizetési mód: Utánvéttel
Bruttó összeg: 7 440Ft`;

test('parses trusted GymBeam order-processing summary without creating an order_created event', () => {
  const result = parseGymBeamOrderProcessingEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Kozma, a rendelésed feldolgozás alatt van.',
    bodyText: body,
  });

  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'order_processing');
  assert.equal(result.extraction.event_type, 'order_updated');
  assert.equal(result.extraction.order_number, '3010085026');
  assert.equal(result.extraction.total, 7440);
  assert.equal(result.extraction.subtotal, 5950);
  assert.equal(result.extraction.shipping_amount, 1190);
  assert.equal(result.extraction.payment_status, 'cash_on_delivery');
  assert.equal(result.extraction.payment_method, 'Utánvéttel');
  assert.equal(result.extraction.carrier, 'Express One');
  assert.equal(result.extraction.products.length, 3);
  assert.equal(result.extraction.products[1]?.quantity, 3);
  assert.equal(result.extraction.products[1]?.unit_price, 390);
  assert.equal(result.extraction.products[1]?.total_price, 1170);
  assert.ok(result.reasons.includes('reconciled_order_total'));
});

test('parses the flattened table shape produced by compacted transactional HTML', () => {
  const flattened = 'Köszönjük! Megkaptuk a rendelésedet. Feldolgozás alatt Elküldve Számla A 3010206178 számú rendelésed már készül! Rendelési összesítő: 1x Cink-kelát (biszglicinát) - GymBeam Kapszula: 90 kapsz. 1 690Ft 1x D3-vitamin 2000 IU - GymBeam Kapszula: 120 kapsz. 1 990Ft 3x Thor - GymBeam Grammsúly: 7 g, Ízesítés: zöldalma 1 590Ft 1x Csuklóbandázs - GymBeam 2 690Ft Szállítás: 1 190Ft Utánvét: 300Ft Szállítási mód: Kikézbesítés Express One futárral Fizetési mód: Utánvéttel Bruttó összeg: 9 450Ft Szállítási cím: Példa cím';
  const result = parseGymBeamOrderProcessingEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Gáborné, a rendelésed feldolgozás alatt van.',
    bodyText: flattened,
  });

  assert.ok(result);
  assert.equal(result.parserVersion, 'gymbeam-order-processing-v1.1');
  assert.equal(result.extraction.order_number, '3010206178');
  assert.equal(result.extraction.total, 9450);
  assert.equal(result.extraction.subtotal, 7960);
  assert.equal(result.extraction.products.length, 4);
  assert.equal(result.extraction.products[2]?.name, 'Thor - GymBeam');
  assert.equal(result.extraction.products[2]?.quantity, 3);
  assert.equal(result.extraction.products[2]?.unit_price, 530);
  assert.equal(result.extraction.products[3]?.name, 'Csuklóbandázs - GymBeam');
});

test('is wired into deterministic lifecycle parsing', () => {
  const result = parseDeterministicLifecycleEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Kozma, a rendelésed feldolgozás alatt van.',
    bodyText: body,
  });
  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'order_processing');
  assert.equal(result.parserVersion, 'gymbeam-order-processing-v1.1');
});

test('does not parse the same text from an untrusted sender', () => {
  assert.equal(parseGymBeamOrderProcessingEmail({
    senderDomains: ['gymbeam.hu.attacker.example'],
    subject: 'Kozma, a rendelésed feldolgozás alatt van.',
    bodyText: body,
  }), null);
});

test('does not parse a shipment update as order processing', () => {
  assert.equal(parseGymBeamOrderProcessingEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Kozma, a megrendelésed úton van!',
    bodyText: 'A 3010085026 számú rendelésedet becsomagoltuk. A 605855680768000013605231 számmal követheted a csomagot.',
  }), null);
});

test('rejects a processing summary whose money does not reconcile', () => {
  assert.equal(parseGymBeamOrderProcessingEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Kozma, a rendelésed feldolgozás alatt van.',
    bodyText: body.replace('Bruttó összeg: 7 440Ft', 'Bruttó összeg: 99 999Ft'),
  }), null);
});
