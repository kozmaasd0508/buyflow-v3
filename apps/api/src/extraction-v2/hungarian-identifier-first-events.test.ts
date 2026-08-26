import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { deriveCorroboratedEventEvidence } from './corroborated-event-evidence.js';
import { runExtractionEngineV2 } from './engine-v2.js';
import { universalOrderNumberExtractor } from './order-number-extractor.js';

function document(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'hu-identifier-first-test',
    receivedAt: '2026-08-25T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'orders@example-shop.hu', name: 'Example Shop' }],
      domains: ['example-shop.hu'],
      primaryEmail: 'orders@example-shop.hu',
      primaryDomain: 'example-shop.hu',
      primaryName: 'Example Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: null,
    text: '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
    },
    ...overrides,
  };
}

test('strong identifier-first Hungarian accepted-order wording corroborates order creation', () => {
  const doc = document({
    subject: 'Köszönjük vásárlását',
    text: '90427163 számú megrendelését fogadtuk.\nrendelés száma\n90427163\nösszesen\n12 535 HUF',
  });
  const orderClaims = universalOrderNumberExtractor.extract(doc);
  assert.ok(orderClaims.some((claim) => claim.field === 'order_number' && claim.value === '90427163' && claim.confidence >= 0.95));

  const claims = deriveCorroboratedEventEvidence(doc, { claims: orderClaims });
  const event = claims.find((claim) => claim.field === 'event_type' && claim.value === 'order_created');
  assert.ok(event);
  assert.ok(event?.qualifiers?.includes('strong_order_identity_corroborated'));
});

test('strong identifier-first Hungarian completed carrier handoff corroborates shipment', () => {
  const doc = document({
    subject: 'Megrendelésének elküldése',
    text: '90427163 számú megrendelését átadtuk a kiszállítónak, hamarosan megérkezik Önhöz.\nrendelés száma\n90427163',
  });
  const orderClaims = universalOrderNumberExtractor.extract(doc);
  assert.ok(orderClaims.some((claim) => claim.field === 'order_number' && claim.value === '90427163' && claim.confidence >= 0.95));

  const claims = deriveCorroboratedEventEvidence(doc, { claims: orderClaims });
  const event = claims.find((claim) => claim.field === 'event_type' && claim.value === 'shipment');
  assert.ok(event);
  assert.ok(event?.qualifiers?.includes('completed_carrier_handoff'));
});

test('future carrier handoff remains non-shipment even with strong order identity', () => {
  const doc = document({
    text: '90427163 számú megrendelését holnap adjuk át a kiszállítónak.\nrendelés száma\n90427163',
  });
  const orderClaims = universalOrderNumberExtractor.extract(doc);
  const claims = deriveCorroboratedEventEvidence(doc, { claims: orderClaims });
  assert.equal(claims.some((claim) => claim.field === 'event_type' && claim.value === 'shipment'), false);
});

test('identifier-first lifecycle wording without strong extracted order identity stays blocked', () => {
  const doc = document({
    text: 'ABC számú megrendelését fogadtuk. Köszönjük.',
    signals: {
      orderNumbers: ['ABC'],
      amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
  });
  const orderClaims = universalOrderNumberExtractor.extract(doc);
  assert.equal(orderClaims.some((claim) => claim.field === 'order_number' && claim.confidence >= 0.95), false);
  const claims = deriveCorroboratedEventEvidence(doc, { claims: orderClaims });
  assert.equal(claims.some((claim) => claim.field === 'event_type'), false);
});

test('full Extraction Engine v2 resolves identifier-first accepted order generically', () => {
  const result = runExtractionEngineV2(document({
    subject: 'Köszönjük vásárlását',
    text: '90427163 számú megrendelését fogadtuk.\nrendelés száma\n90427163\nfizetés\nUtánvéttel\nösszesen\n12 535 HUF',
  }));
  assert.equal(result.resolved.eventType.value, 'order_created');
  assert.equal(result.resolved.orderNumber.value, '90427163');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
});

test('full Extraction Engine v2 resolves identifier-first completed handoff generically', () => {
  const result = runExtractionEngineV2(document({
    subject: 'Megrendelésének elküldése',
    text: '90427163 számú megrendelését átadtuk a kiszállítónak, hamarosan megérkezik Önhöz.\nrendelés száma\n90427163',
  }));
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.orderNumber.value, '90427163');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
});
