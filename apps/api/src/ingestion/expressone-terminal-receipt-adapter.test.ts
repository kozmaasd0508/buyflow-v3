import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseExpressOneTerminalReceipt,
  resolveExpressOneTerminalReceipt,
  type ExpressOneReceiptCandidate,
} from './expressone-terminal-receipt-adapter.js';

const receiptBody = `Card Type: MasterCard
TRANSACTION TYPE: Vásárlás
Total HUF: 9450
STATUS: Success`;

test('parses a successful Express One terminal purchase receipt', () => {
  const parsed = parseExpressOneTerminalReceipt({
    from: [{ email: 'slip@expressone.hu' }],
    subject: 'Fizetési bizonylat',
    bodyText: receiptBody,
  });
  assert.deepEqual(parsed, { amount: 9450, currency: 'HUF', cardType: 'MasterCard' });
});

test('rejects failed receipt and spoofed sender', () => {
  assert.equal(parseExpressOneTerminalReceipt({
    from: [{ email: 'slip@expressone.hu' }],
    subject: 'Fizetési bizonylat',
    bodyText: receiptBody.replace('STATUS: Success', 'STATUS: Failed'),
  }), null);
  assert.equal(parseExpressOneTerminalReceipt({
    from: [{ email: 'slip@expressone.hu.attacker.example' }],
    subject: 'Fizetési bizonylat',
    bodyText: receiptBody,
  }), null);
});

function candidate(overrides: Partial<ExpressOneReceiptCandidate> = {}): ExpressOneReceiptCandidate {
  return {
    purchaseId: 'p1',
    totalAmount: 9450,
    currency: 'HUF',
    paymentMethod: 'Utánvéttel',
    expectedCarrier: 'Express One',
    shipmentCarrier: 'Express One',
    shipmentLastEventAt: '2026-07-16T14:55:20Z',
    ...overrides,
  };
}

test('links only a single exact COD Express One candidate close to the parcel event', () => {
  const result = resolveExpressOneTerminalReceipt({
    receipt: { amount: 9450, currency: 'HUF', cardType: 'MasterCard' },
    receivedAt: '2026-07-16T14:42:48Z',
    candidates: [candidate()],
  });
  assert.equal(result.decision, 'linkable');
  assert.equal(result.purchaseId, 'p1');
  assert.ok(result.reasons.includes('single_candidate'));
});

test('keeps ambiguity in review and never picks between two candidates', () => {
  const result = resolveExpressOneTerminalReceipt({
    receipt: { amount: 9450, currency: 'HUF', cardType: 'MasterCard' },
    receivedAt: '2026-07-16T14:42:48Z',
    candidates: [candidate(), candidate({ purchaseId: 'p2' })],
  });
  assert.equal(result.decision, 'review');
  assert.equal(result.purchaseId, null);
  assert.ok(result.reasons.includes('multiple_cod_expressone_amount_time_candidates'));
});

test('does not link by amount alone without COD, carrier, and time corroboration', () => {
  const bad = [
    candidate({ paymentMethod: 'Bankkártya online' }),
    candidate({ expectedCarrier: 'GLS' }),
    candidate({ shipmentCarrier: 'DPD' }),
    candidate({ shipmentLastEventAt: '2026-07-15T08:00:00Z' }),
  ];
  for (const entry of bad) {
    const result = resolveExpressOneTerminalReceipt({
      receipt: { amount: 9450, currency: 'HUF', cardType: 'MasterCard' },
      receivedAt: '2026-07-16T14:42:48Z',
      candidates: [entry],
    });
    assert.equal(result.decision, 'review');
    assert.equal(result.purchaseId, null);
  }
});
