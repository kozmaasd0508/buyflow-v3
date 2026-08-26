import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type {
  TechnicalEvidenceShadowV15Result,
  TechnicalEvidenceV15,
} from './technical-evidence-v1-5.js';
import {
  applyTechnicalEvidenceDirectionGateV1,
  summarizeTechnicalEvidenceDirectionGateV1,
} from './technical-evidence-direction-gate-v1.js';

function document(text: string, subject = 'Carrier notification'): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'opaque-test-id',
    receivedAt: '2026-08-24T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'no-reply@carrier.example', name: 'Carrier' }],
      domains: ['carrier.example'],
      primaryEmail: 'no-reply@carrier.example',
      primaryDomain: 'carrier.example',
      primaryName: 'Carrier',
    },
    recipients: { to: [{ email: 'user@example.com' }], cc: [], bcc: [] },
    subject,
    text,
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
  };
}

function row(input: Partial<TechnicalEvidenceV15> & Pick<TechnicalEvidenceV15, 'kind' | 'rawValue' | 'source'>): TechnicalEvidenceV15 {
  return {
    kind: input.kind,
    rawValue: input.rawValue,
    normalizedValue: input.normalizedValue ?? input.rawValue,
    namespace: input.namespace,
    source: input.source,
    sourcePath: input.sourcePath ?? 'test.path',
    extractorId: input.extractorId ?? 'test-extractor',
    extractorVersion: input.extractorVersion ?? '1.0.0',
    confidence: input.confidence ?? 0.995,
    qualifiers: input.qualifiers ?? [],
  };
}

function technicalEvidence(rows: TechnicalEvidenceV15[]): TechnicalEvidenceShadowV15Result {
  return {
    schemaVersion: 1,
    collectorVersion: '1.5.0',
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: rows,
    ranExtractors: [],
  };
}

const carrier = () => row({
  kind: 'carrier',
  rawValue: 'Foxpost',
  normalizedValue: 'Foxpost',
  namespace: 'FOXPOST',
  source: 'carrier_semantic',
  confidence: 0.995,
});

test('seller self-service dropoff blocks purchase lifecycle authority but preserves audit evidence', () => {
  const event = row({
    kind: 'event',
    rawValue: 'Tömeges csomagfeladás visszaigazolása',
    normalizedValue: 'shipment',
    source: 'html_title',
  });
  const input = technicalEvidence([carrier(), event]);
  const before = JSON.stringify(input);

  const result = applyTechnicalEvidenceDirectionGateV1({
    document: document('Ön a csomagautomatán a feladás során 11 db csomag feladását rögzítette.'),
    technicalEvidence: input,
  });

  assert.equal(result.direction, 'seller_outbound');
  assert.equal(result.purchaseAuthorityEligible, false);
  assert.deepEqual(result.eligibleEvidence.map((item) => item.kind), ['carrier']);
  assert.deepEqual(result.blockedEvidence.map((item) => item.kind), ['event']);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.evidence.length, 2);
});

test('return-to-seller carrier message blocks tracking from buyer Purchase authority', () => {
  const tracking = row({
    kind: 'tracking_number',
    rawValue: 'CLFOX123456789',
    normalizedValue: 'CLFOX123456789',
    namespace: 'FOXPOST',
    source: 'carrier_semantic',
  });

  const result = applyTechnicalEvidenceDirectionGateV1({
    document: document('A címzett által át nem vett és visszaszállított csomagja megérkezett, amely átvehető.'),
    technicalEvidence: technicalEvidence([carrier(), tracking]),
  });

  assert.equal(result.direction, 'return_to_seller');
  assert.equal(result.purchaseAuthorityEligible, false);
  assert.equal(result.blockedEvidence.length, 1);
  assert.equal(result.blockedEvidence[0]?.kind, 'tracking_number');
  assert.equal(result.eligibleEvidence.some((item) => item.kind === 'tracking_number'), false);
});

test('buyer-inbound carrier shipment keeps event and tracking eligible', () => {
  const tracking = row({
    kind: 'tracking_number',
    rawValue: 'CLFOX123456789',
    normalizedValue: 'CLFOX123456789',
    namespace: 'FOXPOST',
    source: 'carrier_semantic',
  });
  const event = row({
    kind: 'event',
    rawValue: 'shipment',
    normalizedValue: 'shipment',
    source: 'carrier_semantic',
  });

  const result = applyTechnicalEvidenceDirectionGateV1({
    document: document('Csomagod, amelyet Merchant Kft adott fel számodra, már raktárunkban van.'),
    technicalEvidence: technicalEvidence([carrier(), tracking, event]),
  });

  assert.equal(result.direction, 'buyer_inbound');
  assert.equal(result.purchaseAuthorityEligible, true);
  assert.equal(result.blockedEvidence.length, 0);
  assert.equal(result.eligibleEvidence.length, 3);
});

test('direct carrier pickup booking is seller-outbound even if it says megrendelés', () => {
  const orderEvent = row({
    kind: 'event',
    rawValue: 'Megrendelés visszaigazolása',
    normalizedValue: 'order_created',
    source: 'html_title',
  });

  const result = applyTechnicalEvidenceDirectionGateV1({
    document: document('Köszönjük megrendelését. Az árufelvételi megbízást a futár elfogadta.'),
    technicalEvidence: technicalEvidence([carrier(), orderEvent]),
  });

  assert.equal(result.direction, 'seller_outbound');
  assert.equal(result.purchaseAuthorityEligible, false);
  assert.equal(result.eligibleEvidence.some((item) => item.kind === 'event'), false);
});

test('merchant evidence without direct-carrier authority is not blocked by carrier-language quotations', () => {
  const orderEvent = row({
    kind: 'event',
    rawValue: 'Order Confirmation',
    normalizedValue: 'order_created',
    source: 'html_title',
  });
  const orderNumber = row({
    kind: 'order_number',
    rawValue: 'ORD-12345',
    normalizedValue: 'ORD-12345',
    namespace: 'MERCHANT:example.com',
    source: 'url',
  });

  const result = applyTechnicalEvidenceDirectionGateV1({
    document: document('A futár árufelvételi megbízása később történik.'),
    technicalEvidence: technicalEvidence([orderEvent, orderNumber]),
  });

  assert.equal(result.direction, 'unknown');
  assert.equal(result.purchaseAuthorityEligible, true);
  assert.equal(result.blockedEvidence.length, 0);
  assert.equal(result.eligibleEvidence.length, 2);
});

test('privacy-safe summary contains no raw identifier values', () => {
  const tracking = row({
    kind: 'tracking_number',
    rawValue: 'CLFOX-SHOULD-NOT-LEAK-123',
    normalizedValue: 'CLFOX-SHOULD-NOT-LEAK-123',
    namespace: 'FOXPOST',
    source: 'carrier_semantic',
  });
  const result = applyTechnicalEvidenceDirectionGateV1({
    document: document('A címzett által át nem vett és visszaszállított csomagja megérkezett.'),
    technicalEvidence: technicalEvidence([carrier(), tracking]),
  });
  const summary = summarizeTechnicalEvidenceDirectionGateV1(result);
  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes('CLFOX-SHOULD-NOT-LEAK-123'), false);
  assert.equal(summary.blockedEvidenceCount, 1);
  assert.deepEqual(summary.blockedKinds, ['tracking_number']);
  assert.equal(summary.productionWrites, 0);
  assert.equal(summary.aiCalls, 0);
});
