import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveReviewPurchaseCandidates,
  type ReviewPurchaseEvidence,
} from './review-purchase-resolution.js';

const userId = 'user-1';

function evidence(overrides: Partial<ReviewPurchaseEvidence> = {}): ReviewPurchaseEvidence {
  return {
    sourceEmailId: 'source-1',
    userId,
    senderDomain: 'shop.example',
    subject: 'Order confirmation 12345678',
    processingStatus: 'review',
    validationStatus: 'review',
    eventType: 'order_created',
    merchant: 'Example Shop',
    merchantLegalName: 'Example Shop Kft.',
    orderNumber: '12345678',
    trackingNumber: null,
    carrier: 'DPD',
    paymentStatus: 'pending',
    confidence: 0.72,
    receivedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

test('JatekBolt-style low-confidence order is created when same-order shipment carries a real tracking number', () => {
  const [candidate] = resolveReviewPurchaseCandidates([
    evidence({
      sourceEmailId: 'order',
      senderDomain: 'jatekbolt.hu',
      merchant: 'JatekBolt.hu',
      merchantLegalName: 'Model & Hobby Kft.',
      orderNumber: '12247833',
      confidence: 0.72,
    }),
    evidence({
      sourceEmailId: 'shipment',
      senderDomain: 'jatekbolt.hu',
      subject: 'Megrendelési szám: #12247833',
      processingStatus: 'review',
      validationStatus: 'validated',
      eventType: 'shipment',
      merchant: 'JatekBolt.hu',
      merchantLegalName: null,
      orderNumber: '12247833',
      trackingNumber: '16380124260518',
      carrier: 'DPD',
      confidence: 0.78,
      receivedAt: '2026-08-04T08:49:02.000Z',
    }),
  ]);

  assert.ok(candidate);
  assert.equal(candidate.decision, 'create');
  assert.ok(candidate.reasons.includes('low_review_order_corroborated_by_exact_tracking_shipment'));
  assert.equal(candidate.sourceLinks.length, 2);
});

test('Gate-style low-confidence order is created when legal identity repeats in shipment evidence', () => {
  const [candidate] = resolveReviewPurchaseCandidates([
    evidence({
      sourceEmailId: 'gate-order',
      senderDomain: 'gate.shop',
      merchant: 'gate.shop',
      merchantLegalName: 'GATE, a.s.',
      orderNumber: '20336215',
      carrier: 'FoxPost / Packeta',
      confidence: 0.72,
    }),
    evidence({
      sourceEmailId: 'gate-shipment',
      senderDomain: 'gate.shop',
      subject: 'Megrendelésének elküldése',
      processingStatus: 'review',
      validationStatus: 'validated',
      eventType: 'shipment',
      merchant: 'gate.shop',
      merchantLegalName: 'GATE, a.s.',
      orderNumber: '20336215',
      trackingNumber: null,
      carrier: 'FoxPost / Packeta',
      confidence: 0.78,
      receivedAt: '2026-07-29T13:02:30.000Z',
    }),
  ]);

  assert.ok(candidate);
  assert.equal(candidate.decision, 'create');
  assert.ok(candidate.reasons.includes('low_review_order_corroborated_by_legal_identity_shipment'));
});

test('Gyerekjatekbolt-style order can use failed payment rows for identity only', () => {
  const rows = [
    evidence({
      sourceEmailId: 'gyerek-order',
      senderDomain: 'gyerekjatekbolt.com',
      merchant: 'Gyerekjatekbolt.com',
      merchantLegalName: null,
      orderNumber: '535574',
      validationStatus: 'guardrailed',
      confidence: 0.84,
    }),
    evidence({
      sourceEmailId: 'gyerek-update',
      senderDomain: 'gyerekjatekbolt.com',
      subject: 'A rendelés állapota megváltozott',
      processingStatus: 'review',
      validationStatus: 'validated',
      eventType: 'order_updated',
      merchant: 'Gyerekjatekbolt.com',
      merchantLegalName: null,
      orderNumber: '535574',
      confidence: 0.74,
      receivedAt: '2026-08-04T11:21:36.000Z',
    }),
    evidence({
      sourceEmailId: 'failed-1',
      senderDomain: 'gyerekjatekbolt.com',
      subject: 'Sikertelen bankkártyás fizetés',
      processingStatus: 'review',
      validationStatus: 'review',
      eventType: 'payment_completed',
      merchant: 'Gyerekjatekbolt.com',
      merchantLegalName: null,
      orderNumber: '535574',
      paymentStatus: 'failed',
      confidence: 0.83,
      receivedAt: '2026-08-02T15:39:22.000Z',
    }),
    evidence({
      sourceEmailId: 'failed-2',
      senderDomain: 'gyerekjatekbolt.com',
      subject: 'Tranzakció sikertelen volt',
      processingStatus: 'review',
      validationStatus: 'review',
      eventType: 'payment_completed',
      merchant: 'Gyerekjatekbolt.com',
      merchantLegalName: null,
      orderNumber: '535574',
      paymentStatus: 'failed',
      confidence: 0.86,
      receivedAt: '2026-08-02T15:48:15.000Z',
    }),
  ];

  const [candidate] = resolveReviewPurchaseCandidates(rows);
  assert.ok(candidate);
  assert.equal(candidate.decision, 'create');
  assert.ok(candidate.reasons.includes('failed_payment_used_for_identity_only'));
  assert.equal(candidate.sourceLinks.some((row) => row.sourceEmailId === 'failed-1'), false);
  assert.equal(candidate.sourceLinks.some((row) => row.sourceEmailId === 'failed-2'), false);
});

test('Szidibox packing subject is lifecycle corroboration, not a second order', () => {
  const [candidate] = resolveReviewPurchaseCandidates([
    evidence({
      sourceEmailId: 'szidi-order',
      senderDomain: 'gmail.com',
      subject: 'Szidibox Karton Kft. Webáruház - Rendelés SO-2024-30411',
      validationStatus: 'guardrailed',
      merchant: 'Szidibox Karton Kft. Webáruház',
      merchantLegalName: null,
      orderNumber: 'SO-2024-30411',
      confidence: 0.88,
    }),
    evidence({
      sourceEmailId: 'szidi-packing',
      senderDomain: 'gmail.com',
      subject: 'Szidibox Karton Kft. Webáruház - Megrendelését összekészítettük SO-2024-30411',
      validationStatus: 'guardrailed',
      merchant: 'Szidibox Karton Kft. Webáruház',
      merchantLegalName: null,
      orderNumber: 'SO-2024-30411',
      confidence: 0.83,
      receivedAt: '2026-07-22T20:02:25.000Z',
    }),
  ]);

  assert.ok(candidate);
  assert.equal(candidate.decision, 'create');
  assert.ok(candidate.reasons.includes('packing_subject_used_as_lifecycle_not_second_order'));
  const packingLink = candidate.sourceLinks.find((row) => row.sourceEmailId === 'szidi-packing');
  assert.equal(packingLink?.relationType, 'order_updated');
});

test('single Allegro-style medium-confidence order stays in review without corroboration', () => {
  const [candidate] = resolveReviewPurchaseCandidates([
    evidence({
      senderDomain: 'allegro.com',
      merchant: 'HappyBox24',
      merchantLegalName: null,
      orderNumber: '3fe09c80-8d79-11f1-b193-cf13a29b46f5',
      validationStatus: 'guardrailed',
      confidence: 0.86,
    }),
  ]);

  assert.ok(candidate);
  assert.equal(candidate.decision, 'review');
});

test('lifecycle-only evidence can never create a purchase', () => {
  const candidates = resolveReviewPurchaseCandidates([
    evidence({
      sourceEmailId: 'shipment-only',
      processingStatus: 'review',
      validationStatus: 'validated',
      eventType: 'shipment',
      confidence: 0.95,
      trackingNumber: '12345678901234',
    }),
  ]);

  assert.deepEqual(candidates, []);
});

test('order without a stable order number can never create a purchase', () => {
  const candidates = resolveReviewPurchaseCandidates([
    evidence({
      orderNumber: null,
      confidence: 0.95,
    }),
  ]);

  assert.deepEqual(candidates, []);
});
