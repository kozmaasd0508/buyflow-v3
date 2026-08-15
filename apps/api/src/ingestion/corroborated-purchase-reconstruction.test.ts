import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMerchantReconstructionEvidence,
  resolveCorroboratedPurchaseReconstructions,
  type CarrierReconstructionEvidence,
  type MerchantReconstructionEvidence,
} from './corroborated-purchase-reconstruction.js';

function merchant(overrides: Partial<MerchantReconstructionEvidence> = {}): MerchantReconstructionEvidence {
  return {
    sourceEmailId: 'merchant-dispatch',
    userId: 'user-1',
    senderDomain: 'example-shop.hu',
    receivedAt: '2026-08-01T10:00:00.000Z',
    orderNumber: 'ORD-12345',
    merchantName: 'Example Shop',
    kind: 'dispatch',
    ...overrides,
  };
}

function carrier(overrides: Partial<CarrierReconstructionEvidence> = {}): CarrierReconstructionEvidence {
  return {
    sourceEmailId: 'carrier-1',
    userId: 'user-1',
    senderDomain: 'gls-hungary.com',
    receivedAt: '2026-08-02T10:00:00.000Z',
    trackingNumber: '1234567890',
    carrier: 'GLS',
    parcelSender: 'Example Shop Kft.',
    shipmentPhase: 'shipment_created',
    codAmount: 16670,
    codCurrency: 'HUF',
    confidence: 0.995,
    ...overrides,
  };
}

function merchantPair(): MerchantReconstructionEvidence[] {
  return [
    merchant(),
    merchant({
      sourceEmailId: 'merchant-invoice',
      receivedAt: '2026-08-02T09:30:00.000Z',
      kind: 'invoice',
    }),
  ];
}

function carrierChain(): CarrierReconstructionEvidence[] {
  return [
    carrier(),
    carrier({
      sourceEmailId: 'carrier-2',
      receivedAt: '2026-08-03T06:00:00.000Z',
      shipmentPhase: 'out_for_delivery',
    }),
    carrier({
      sourceEmailId: 'carrier-3',
      receivedAt: '2026-08-03T07:00:00.000Z',
      shipmentPhase: 'in_transit',
      parcelSender: null,
      codAmount: null,
      codCurrency: null,
    }),
  ];
}

test('parses strict Hungarian dispatch and invoice subject evidence from a merchant-owned domain', () => {
  const dispatch = parseMerchantReconstructionEvidence({
    id: 'dispatch',
    user_id: 'user-1',
    from_address: 'info@allinpackaging.com',
    subject: 'All In Packaging: #148810 Rendelés elküldve.',
    received_at: '2026-07-31T11:22:50.000Z',
  });
  const invoice = parseMerchantReconstructionEvidence({
    id: 'invoice',
    user_id: 'user-1',
    from_address: 'info@allinpackaging.com',
    subject: 'SZÁMLA All In Packaging (148810) számú webrendeléshez',
    received_at: '2026-08-03T09:24:42.000Z',
  });
  assert.equal(dispatch?.kind, 'dispatch');
  assert.equal(dispatch?.orderNumber, '148810');
  assert.equal(invoice?.kind, 'invoice');
  assert.equal(invoice?.orderNumber, '148810');
});

test('does not accept the same transactional-looking subject from a public mailbox', () => {
  const parsed = parseMerchantReconstructionEvidence({
    id: 'mail',
    user_id: 'user-1',
    from_address: 'shop@gmail.com',
    subject: 'Example Shop: #ORD-12345 Rendelés elküldve.',
    received_at: '2026-08-01T10:00:00.000Z',
  });
  assert.equal(parsed, null);
});

test('does not accept a merchant label that does not match the sender domain', () => {
  const parsed = parseMerchantReconstructionEvidence({
    id: 'mail',
    user_id: 'user-1',
    from_address: 'notice@shared-notify.example',
    subject: 'Example Shop: #ORD-12345 Rendelés elküldve.',
    received_at: '2026-08-01T10:00:00.000Z',
  });
  assert.equal(parsed, null);
});

test('reconstructs only with dispatch plus invoice plus one corroborated COD carrier group', () => {
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), carrierChain());
  assert.ok(decision);
  assert.equal(decision.decision, 'reconstruct');
  assert.equal(decision.orderNumber, 'ORD-12345');
  assert.equal(decision.totalAmount, 16670);
  assert.equal(decision.currency, 'HUF');
  assert.equal(decision.carrierSlug, 'gls');
  assert.equal(decision.trackingNumber, '1234567890');
  assert.equal(decision.primaryCarrierSourceId, 'carrier-2');
  assert.equal(decision.shippedAt, '2026-08-03T06:00:00.000Z');
  assert.equal(decision.lastEventAt, '2026-08-03T07:00:00.000Z');
  assert.deepEqual(new Set(decision.merchantSourceEmailIds), new Set(['merchant-dispatch', 'merchant-invoice']));
  assert.deepEqual(new Set(decision.carrierSourceEmailIds), new Set(['carrier-1', 'carrier-2', 'carrier-3']));
});

test('single merchant source cannot reconstruct a purchase', () => {
  const decisions = resolveCorroboratedPurchaseReconstructions([merchant()], carrierChain());
  assert.equal(decisions.length, 0);
});

test('dispatch and invoice must carry the same order identity', () => {
  const rows = [
    merchant(),
    merchant({ sourceEmailId: 'invoice', kind: 'invoice', orderNumber: 'ORD-99999' }),
  ];
  const decisions = resolveCorroboratedPurchaseReconstructions(rows, carrierChain());
  assert.equal(decisions.length, 0);
});

test('one carrier event is insufficient even with exact COD and parcel sender', () => {
  const [decision] = resolveCorroboratedPurchaseReconstructions(
    merchantPair(),
    [carrier({ shipmentPhase: 'out_for_delivery' })],
  );
  assert.equal(decision?.decision, 'unmatched');
});

test('carrier chain without explicit COD is insufficient', () => {
  const rows = carrierChain().map((row) => ({ ...row, codAmount: null, codCurrency: null }));
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), rows);
  assert.equal(decision?.decision, 'unmatched');
});

test('carrier parcel sender must match merchant identity', () => {
  const rows = carrierChain().map((row) => ({ ...row, parcelSender: row.parcelSender ? 'Different Merchant Kft.' : null }));
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), rows);
  assert.equal(decision?.decision, 'unmatched');
});

test('pre-advice-only carrier evidence is insufficient', () => {
  const rows = [
    carrier(),
    carrier({ sourceEmailId: 'carrier-2', receivedAt: '2026-08-02T11:00:00.000Z' }),
  ];
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), rows);
  assert.equal(decision?.decision, 'unmatched');
});

test('two eligible COD carrier groups are ambiguous and go to review', () => {
  const second = carrierChain().map((row, index) => ({
    ...row,
    sourceEmailId: `other-${index}`,
    trackingNumber: '9999999999',
  }));
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), [...carrierChain(), ...second]);
  assert.equal(decision?.decision, 'review');
  assert.ok(decision?.reasons.includes('multiple_cod_carrier_groups'));
});

test('an additional same-merchant carrier group without COD does not create ambiguity', () => {
  const noCod = carrierChain().slice(0, 2).map((row, index) => ({
    ...row,
    sourceEmailId: `no-cod-${index}`,
    trackingNumber: '2222222222',
    codAmount: null,
    codCurrency: null,
  }));
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), [...carrierChain(), ...noCod]);
  assert.equal(decision?.decision, 'reconstruct');
  assert.equal(decision?.trackingNumber, '1234567890');
});

test('merchant and carrier evidence outside seven days does not reconstruct', () => {
  const rows = carrierChain().map((row) => ({ ...row, receivedAt: '2026-08-20T10:00:00.000Z' }));
  const [decision] = resolveCorroboratedPurchaseReconstructions(merchantPair(), rows);
  assert.equal(decision?.decision, 'unmatched');
});
