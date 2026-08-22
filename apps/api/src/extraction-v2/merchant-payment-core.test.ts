import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { universalMerchantExtractor } from './merchant-extractor.js';
import { universalPaymentStatusExtractor } from './payment-status-extractor.js';
import { universalInvoicePaymentReferenceExtractor } from './invoice-payment-reference-extractor.js';
import { collectUniversalCoreEvidence } from './universal-core.js';

function email(input: { subject: string; snippet?: string; sender?: string; name?: string }): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `test-${Math.random()}`,
    subject: input.subject,
    from: [{ email: input.sender ?? 'orders@example-shop.hu', ...(input.name ? { name: input.name } : {}) }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T20:00:00.000Z',
    snippet: input.snippet ?? input.subject,
    folders: ['inbox'],
    attachments: [],
  };
}

test('merchant extractor prefers explicit merchant evidence and keeps sender name as weaker fallback', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Rendelési értesítő',
    snippet: 'Eladó: MODELL&HOBBY Kft.',
    name: 'Order Robot',
  }));
  const claims = universalMerchantExtractor.extract(document).filter((claim) => claim.field === 'merchant');
  assert.ok(claims.some((claim) => claim.value === 'MODELL&HOBBY Kft.' && claim.confidence >= 0.98));
  assert.ok(claims.some((claim) => claim.value === 'Order Robot' && claim.confidence < 0.8));
});

test('merchant extractor accepts explicit parcel sender but ignores generic mailbox display names', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Csomagértesítő',
    snippet: 'Feladó: FNP Products',
    name: 'Support',
  }));
  const claims = universalMerchantExtractor.extract(document).filter((claim) => claim.field === 'merchant');
  assert.ok(claims.some((claim) => claim.value === 'FNP Products'));
  assert.ok(!claims.some((claim) => claim.value === 'Support'));
});

test('payment status extractor distinguishes paid, failed, COD and refunded evidence', () => {
  const cases: Array<[string, string]> = [
    ['Sikeres bankkártyás fizetés', 'paid'],
    ['Sikertelen fizetés', 'failed'],
    ['Fizetési mód: Utánvét', 'cash_on_delivery'],
    ['Visszatérítés megtörtént', 'refunded'],
  ];

  for (const [snippet, expected] of cases) {
    const claims = universalPaymentStatusExtractor.extract(buildEmailDocumentV1(email({ subject: 'Fizetési értesítő', snippet })));
    assert.ok(claims.some((claim) => claim.field === 'payment_status' && claim.value === expected), snippet);
  }
});

test('payment status extractor does not infer paid from payment method alone or negated success', () => {
  const paymentMethodOnly = universalPaymentStatusExtractor.extract(buildEmailDocumentV1(email({
    subject: 'Rendelés',
    snippet: 'Fizetési mód: Bankkártya',
  })));
  assert.equal(paymentMethodOnly.length, 0);

  const negated = universalPaymentStatusExtractor.extract(buildEmailDocumentV1(email({
    subject: 'Fizetési értesítő',
    snippet: 'A fizetés nem sikeres, próbáld újra.',
  })));
  assert.ok(!negated.some((claim) => claim.value === 'paid'));
});

test('invoice/payment reference extractor handles Hungarian and English labeled identifiers', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Számla 2026/060906',
    snippet: 'Számlaszám: E2026/49/0080/14707\nTranzakció azonosító: TX-93827164',
  }));
  const claims = universalInvoicePaymentReferenceExtractor.extract(document);
  assert.ok(claims.some((claim) => claim.field === 'invoice_number' && claim.value === 'E2026/49/0080/14707'));
  assert.ok(claims.some((claim) => claim.field === 'payment_reference' && claim.value === 'TX-93827164'));
});

test('invoice/payment reference extractor rejects label text without a stable identifier', () => {
  const claims = universalInvoicePaymentReferenceExtractor.extract(buildEmailDocumentV1(email({
    subject: 'Számla elkészült',
    snippet: 'Számlaszám: hamarosan elérhető\nTransaction ID: pending',
  })));
  assert.equal(claims.length, 0);
});

test('universal core collector runs all six evidence extractors without short-circuiting', () => {
  const result = collectUniversalCoreEvidence(buildEmailDocumentV1(email({
    subject: 'Rendelés #AB-12345 sikeres fizetés',
    snippet: 'Eladó: Example Store\nVégösszeg: 12 990 Ft\nTracking number: 123456789012\nInvoice number: INV-2026-1234',
    name: 'Example Store',
  })));
  assert.equal(result.ranExtractors.length, 6);
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'merchant'));
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'payment_status'));
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'invoice_number'));
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'order_number'));
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'tracking_number'));
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'total'));
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'currency'));
});
