import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import {
  compareCanonicalSnapshots,
  compareLegacyAndExtractionV2,
  type CanonicalFieldSnapshot,
} from './extraction-v2-shadow-comparison.js';

function emptySnapshot(): CanonicalFieldSnapshot {
  return {
    eventType: null,
    merchant: null,
    orderNumber: null,
    total: null,
    currency: null,
    carrier: null,
    trackingNumber: null,
    paymentStatus: null,
    invoiceNumber: null,
    paymentReference: null,
    products: null,
  };
}

function email(subject: string, snippet: string): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `shadow-${Math.random()}`,
    subject,
    from: [{ email: 'orders@example-shop.hu', name: 'Example Store' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T20:00:00.000Z',
    snippet,
    folders: ['inbox'],
    attachments: [],
  };
}

test('snapshot comparison normalizes harmless string representation differences', () => {
  const legacy = { ...emptySnapshot(), orderNumber: 'AB-12345', merchant: 'Example Store Kft.' };
  const v2 = { ...emptySnapshot(), orderNumber: 'ab-12345', merchant: 'example   store kft.' };
  const fields = compareCanonicalSnapshots({ legacy, v2 });
  assert.equal(fields.find((field) => field.field === 'orderNumber')?.status, 'same');
  assert.equal(fields.find((field) => field.field === 'merchant')?.status, 'same');
});

test('product comparison ignores item ordering but preserves name and quantity semantics', () => {
  const legacy = {
    ...emptySnapshot(),
    products: [
      { name: 'Product A', quantity: 1 },
      { name: 'Product B', quantity: 2 },
    ],
  };
  const v2 = {
    ...emptySnapshot(),
    products: [
      { name: 'product b', quantity: 2, unitPrice: null, totalPrice: null, currency: null },
      { name: 'PRODUCT A', quantity: 1, unitPrice: null, totalPrice: null, currency: null },
    ],
  };
  const fields = compareCanonicalSnapshots({ legacy, v2 });
  assert.equal(fields.find((field) => field.field === 'products')?.status, 'same');
});

test('v2 conflicts are surfaced as v2_conflict rather than different', () => {
  const legacy = { ...emptySnapshot(), carrier: 'DPD' };
  const v2 = { ...emptySnapshot(), carrier: null };
  const fields = compareCanonicalSnapshots({ legacy, v2, v2ConflictFields: ['carrier'] });
  assert.equal(fields.find((field) => field.field === 'carrier')?.status, 'v2_conflict');
});

test('shadow comparison never claims accuracy and never writes or calls AI', () => {
  const result = compareLegacyAndExtractionV2(email(
    'A csomagod feladásra került',
    'Futárszolgálat: DPD\nTracking number: 13169408547018',
  ));
  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.accuracyClaimed, false);
  assert.equal(result.fields.length, 11);
});
