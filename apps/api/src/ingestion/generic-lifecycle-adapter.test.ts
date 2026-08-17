import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericLifecycleEmail } from './generic-lifecycle-adapter.js';

test('parses merchant shipment with explicit dispatch and tracking identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['shop.shopbuilder.hu'],
    subject: 'Csomagod úton',
    bodyText: [
      'Az általad 2026-06-21-én rendelt csomagot 2026-06-22 napon feladtuk.',
      'Futárszolgálat: GLS',
      'Csomagszám: 3406978622',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'shipment');
  assert.equal(parsed.shipmentPhase, 'shipped');
  assert.equal(parsed.extraction.tracking_number, '3406978622');
  assert.equal(parsed.extraction.order_number, null);
});

test('parses merchant in-transit message with exact order identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['noreply.rossmann.hu'],
    subject: 'Rossmann csomagod úton van',
    bodyText: [
      'Csomagod már úton van, hamarosan kézhez kaphatod.',
      'A rendelés #212109289 (létrejött: 2026. április 18. 21:12)',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'shipment');
  assert.equal(parsed.shipmentPhase, 'in_transit');
  assert.equal(parsed.extraction.order_number, '212109289');
});

test('parses formal Hungarian shipped wording when the order identity comes before the order noun', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['sinsay.com'],
    subject: 'Visszaigazolás arról, hogy a 15710474710 rendelést elküldték.',
    bodyText: 'A megrendelését elküldtük. A következő napokban megkapja.',
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'shipment');
  assert.equal(parsed.shipmentPhase, 'shipped');
  assert.equal(parsed.extraction.order_number, '15710474710');
});

test('parses invoice tied to an explicit order identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['info.jatektenger.hu'],
    subject: 'Számla 2026/08659 - Rendelésszám: 26083-131173',
    bodyText: 'Tájékoztatunk, hogy új elektronikus számlád került kiállításra a megrendelésedhez.',
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'invoice_or_receipt');
  assert.equal(parsed.extraction.order_number, '26083-131173');
  assert.equal(parsed.extraction.invoice_number, '2026/08659');
});

test('parses ready-for-pickup only with a hard purchase identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['orders.demo-shop.hu'],
    subject: 'Rendelésed átvehető',
    bodyText: 'Rendelésszám: HU-991188\nRendelésed már átvehető az üzletben.',
  });

  assert.ok(parsed);
  assert.equal(parsed.shipmentPhase, 'ready_for_pickup');
  assert.equal(parsed.extraction.order_number, 'HU-991188');
});

test('parses out-for-delivery and delivery as separate states', () => {
  const outForDelivery = parseGenericLifecycleEmail({
    senderDomains: ['orders.demo-shop.hu'],
    subject: 'Ma érkezik a csomagod',
    bodyText: 'Order number: DEMO-778899\nYour package is out for delivery.',
  });
  const delivered = parseGenericLifecycleEmail({
    senderDomains: ['orders.demo-shop.hu'],
    subject: 'Rendelésed kézbesítve',
    bodyText: 'Rendelésszám: DEMO-778899\nRendelésed sikeresen kézbesítve.',
  });

  assert.ok(outForDelivery);
  assert.equal(outForDelivery.shipmentPhase, 'out_for_delivery');
  assert.equal(outForDelivery.extraction.event_type, 'shipment');
  assert.ok(delivered);
  assert.equal(delivered.shipmentPhase, 'delivered');
  assert.equal(delivered.extraction.event_type, 'delivery');
});

test('rejects utility invoice without order identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['ugyfelszolgalat.dijnet.hu'],
    subject: 'Díjnet számla érkezett',
    bodyText: 'Tájékoztatjuk, hogy új számlája érkezett. Ügyfélazonosító: 690000194345.',
  });
  assert.equal(parsed, null);
});

test('rejects carrier senders from the generic merchant lifecycle lane', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['expressone.hu'],
    subject: 'Küldemény kézbesítve',
    bodyText: 'Csomagszám: 605855688145000013605231\nCsomagod sikeresen kézbesítve.',
  });
  assert.equal(parsed, null);
});

test('rejects public mailbox senders from the generic merchant lifecycle lane', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['gmail.com'],
    subject: 'Csomagod úton van',
    bodyText: 'Rendelésszám: X-99118\nCsomagodat feladtuk.',
  });
  assert.equal(parsed, null);
});

test('rejects marketing wording without order or tracking hard anchor', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['kfc.hu'],
    subject: 'KFC? Díjmentesen úton!',
    bodyText: 'Katt és rendelj!',
  });
  assert.equal(parsed, null);
});

test('does not parse lifecycle evidence that exists only in quoted reply history', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['support.demo-shop.hu'],
    subject: 'Re: kérdés a rendelésemről',
    bodyText: [
      'Kedves Vásárló, utánanézünk.',
      '2026. aug. 10. ezt írta:',
      '> Rendelésszám: OLD-778899',
      '> Csomagod úton van.',
    ].join('\n'),
  });
  assert.equal(parsed, null);
});

test('keeps fresh lifecycle evidence above an older quoted thread', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['support.demo-shop.hu'],
    subject: 'Re: rendelés DEMO-778899',
    bodyText: [
      'Rendelésszám: DEMO-778899',
      'Csomagodat átadtuk a futárszolgálatnak.',
      'On Mon, Aug 10, 2026 Customer wrote:',
      '> Korábbi kérdés.',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.shipmentPhase, 'shipped');
  assert.equal(parsed.extraction.order_number, 'DEMO-778899');
});
