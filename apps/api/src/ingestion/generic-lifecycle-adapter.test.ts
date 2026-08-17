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
  assert.equal(parsed.parserVersion, 'generic-lifecycle-v1.2');
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

test('keeps order-level in-transit wording when physical fulfillment is independently present', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['orders.unknown-shop.hu'],
    subject: 'A HU991188 rendelésed már úton van',
    bodyText: [
      'Rendelésszám: HU991188',
      'Küldemény azonosítója: 1979394976',
      'A csomagot nyomon követheted a futár oldalán.',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.extraction.event_type, 'shipment');
  assert.equal(parsed.shipmentPhase, 'in_transit');
  assert.equal(parsed.extraction.order_number, 'HU991188');
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

test('does not treat Oazis procurement future pickup notification as ready for pickup', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['oaziscomputer.hu'],
    subject: '[#215048] - Beszerzés alatt',
    bodyText: [
      'Rendelés azonosító #215048',
      'Megrendelésed beszerzése folyamatban.',
      'További e-mailben értesítünk, amint rendelésed átvehető, vagy szállítható.',
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('does not treat Klarstein processing FAQ future handoff as shipped', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['xqueue.berlin-brands-group.com'],
    subject: 'Köszönjük Klarstein sz. megrendelését',
    bodyText: [
      'Tájékoztatjuk, hogy rendelését fogadtuk és jelenleg feldolgozás alatt van.',
      'Megrendelés száma: 0408253445',
      'A számlát e-mailben küldjük, mikor a rendelését átadtuk a futárszolgálatnak.',
      'Miután a küldeményét átadtuk a futárcégnek, e-mailben küldjük el annak csomagkövetését.',
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('keeps a current shipment when the same email also explains a future pickup notification', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['orders.demo-shop.hu'],
    subject: 'Rendelésed feladva',
    bodyText: [
      'Rendelésszám: HU-889911',
      'Rendelésedet átadtuk a futárszolgálatnak.',
      'E-mailben értesítünk, amikor rendelésed átvehető lesz az automatában.',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.shipmentPhase, 'shipped');
  assert.equal(parsed.extraction.order_number, 'HU-889911');
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

test('rejects digital ticket purchase whose subject merely says the order is on its way', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['boditesok.hu'],
    subject: 'A rendelésed úton van a(z) Bódi Tesók oldalról!',
    bodyText: [
      'A rendelésedet sikeresen feldolgoztuk.',
      'Rendelés #288498',
      'VIP jegy - Őszi Roadshow 2025',
      'EXTRA GYORS SZÁLLÍTÁS: 298 Ft',
      'Esemény helyszín: Törökszentmiklós',
      'Esemény dátum: 2025-11-15',
    ].join('\n'),
  });
  assert.equal(parsed, null);
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

test('rejects observed Chameleoon shipment relay as merchant identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['shipments.chameleoon.sk'],
    subject: 'Az engaro rendelésedet átadta a futárnak',
    bodyText: 'Rendelésszám: 25051657\nRendelésedet átadtuk a futárszolgálatnak.',
  });
  assert.equal(parsed, null);
});

test('rejects Szamlazz.hu provider infrastructure as merchant identity even for merchant-branded shipment copy', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['szamlazz.hu'],
    subject: '1140165 számú Marketa.hu rendelésedet átadtuk a futárszolgálatnak',
    bodyText: 'Rendelésszám: 1140165\nRendelésedet átadtuk a futárszolgálatnak.',
  });
  assert.equal(parsed, null);
});

test('rejects Billingo provider infrastructure as merchant identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['mail.billingo.hu'],
    subject: 'Számlád elkészült',
    bodyText: 'Rendelésszám: DEMO-889911\nSzámlád elkészült. Számlaszám: DEMO/2026/18',
  });
  assert.equal(parsed, null);
});

test('rejects documented MyShoprenter fallback sender infrastructure as merchant identity', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['myshoprenter.hu'],
    subject: 'Rendelésed úton van',
    bodyText: 'Rendelésszám: SR-889911\nRendelésed már úton van.',
  });
  assert.equal(parsed, null);
});

test('known merchant sender cannot bypass its dedicated parser through generic fallback', () => {
  const parsed = parseGenericLifecycleEmail({
    senderDomains: ['dorko.hu'],
    subject: 'DK2001799 - rendelésed úton van - átadtuk a GLS futárnak!',
    bodyText: 'Rendelésszám: DK2001799\nCsomagod hamarosan kézhez kapod.',
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
