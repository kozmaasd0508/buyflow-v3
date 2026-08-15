import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroOrderEmail } from './allegro-order-adapter.js';
import { parseAllegroLifecycleEmail } from './allegro-lifecycle-adapter.js';

const uuid = '3fe09c80-8d79-11f1-b193-cf13a29b46f5';
const tracking = '13169408547018';

const merchantBody = `Szia KozmaGabi,
A csomagodat most adták fel. Kövesd nyomon itt:
https://t.allegro.hu/allegro-fiokom/vasarlasok/vasarlasi-elozmenyek/${uuid}?utm_source=coma_email
Szállítói és küldeményazonosító
DPD ${tracking}
Vásárlásod
3 db-os kulacs szett motivációs edzéshez 2000ml+900ml+300ml`;

test('parses an Allegro shipped message using purchase-history UUID and carrier tracking pair', () => {
  const result = parseAllegroLifecycleEmail({
    senderDomains: ['allegro.com'],
    subject: 'A csomagod már úton van! Tartalma: 3 db-os kulacs szett',
    bodyText: merchantBody,
  });

  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.order_number, uuid);
  assert.equal(result.extraction.tracking_number, tracking);
  assert.equal(result.extraction.carrier, 'DPD');
  assert.equal(result.shipmentPhase, 'shipped');
  assert.equal(result.parserVersion, 'allegro-lifecycle-v1');
});

test('routes Allegro lifecycle through the existing central Allegro adapter', () => {
  const result = parseAllegroOrderEmail({
    senderDomains: ['allegro.com'],
    subject: 'A csomagod már úton van! Tartalma: kulacs szett',
    bodyText: merchantBody,
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'shipped');
  assert.equal(result.extraction.order_number, uuid);
});

test('parses Allegro out-for-delivery as shipment, never final delivery', () => {
  const result = parseAllegroLifecycleEmail({
    senderDomains: ['allegro.hu'],
    subject: 'A futár ma érkezik. A következő termékeket tartalmazó csomagot szállítja ki: kulacs szett',
    bodyText: merchantBody.replace('A csomagodat most adták fel.', 'A futár ma érkezik.'),
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'out_for_delivery');
  assert.equal(result.extraction.order_number, uuid);
  assert.equal(result.extraction.tracking_number, tracking);
});

test('parses DPD dispatch relayed through Allegro mail without inventing an order number', () => {
  const result = parseAllegroLifecycleEmail({
    senderDomains: ['allegromail.com'],
    subject: `Értesítés ${tracking} nemzetközi küldemény feladásáról`,
    bodyText: `myDPD csomag nyomon követés https://www.dpdgroup.com/hu/mydpd/my-parcels/track?parcelNumber=${tracking}`,
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'shipped');
  assert.equal(result.extraction.order_number, null);
  assert.equal(result.extraction.tracking_number, tracking);
  assert.equal(result.extraction.carrier, 'DPD');
});

test('parses DPD delivery-today relay as out-for-delivery and keeps merchant hint', () => {
  const result = parseAllegroLifecycleEmail({
    senderDomains: ['allegromail.com'],
    subject: `Értesítés ${tracking} HappyBox24 küldemény mai kézbesítéséről`,
    bodyText: 'A futár ma kézbesíti a küldeményt.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'out_for_delivery');
  assert.equal(result.extraction.merchant, 'HappyBox24');
  assert.equal(result.extraction.tracking_number, tracking);
});

test('parses only explicit successful DPD delivery as delivered', () => {
  const result = parseAllegroLifecycleEmail({
    senderDomains: ['allegromail.com'],
    subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
    bodyText: `Értesítjük, hogy ${tracking} küldeményét a mai napon sikeresen kézbesítettük.`,
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'delivery');
  assert.equal(result.shipmentPhase, 'delivered');
});

test('rejects lookalike Allegro domains and unrelated sales documents', () => {
  assert.equal(parseAllegroLifecycleEmail({
    senderDomains: ['allegromail.com.attacker.example'],
    subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
    bodyText: `A ${tracking} küldeményt sikeresen kézbesítettük.`,
  }), null);

  assert.equal(parseAllegroLifecycleEmail({
    senderDomains: ['allegromail.com'],
    subject: 'Megrendelésre szánt értékesítési dokumentum 46181083',
    bodyText: 'Dokument sprzedaży do zamówienia 46181083',
  }), null);
});
