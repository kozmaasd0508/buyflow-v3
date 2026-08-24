import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPdfPaymentTechnicalEvidenceV1 } from './technical-evidence-pdf-payment-v1.js';

test('GLS COD PDF receipt yields namespaced payment and parcel evidence', () => {
  const result = collectPdfPaymentTechnicalEvidenceV1({
    senderDomains: ['gls-hungary.com'],
    filename: 'paymentReceipt_3408405000.pdf',
    text: `
      GLS General Logistics Systems
      Hungary Csomag-Logisztikai Kft.
      CSOMAGSZÁM: 03408405000
      ÖSSZEG: 7450,00
      TRANZAKCIÓS SZÁM: 20260713112151670000
    `,
  });

  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'payment_completed'));
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === '3408405000'
    && row.namespace === 'GLS'));
  assert.ok(result.evidence.some((row) => row.kind === 'payment_reference'
    && row.normalizedValue === '20260713112151670000'
    && row.namespace === 'GLS_COD'));
  assert.ok(result.evidence.some((row) => row.kind === 'amount'
    && row.normalizedValue === '7450.00'));
  assert.ok(result.evidence.some((row) => row.kind === 'currency'
    && row.normalizedValue === 'HUF'));
});

test('GLS COD PDF adapter fails closed for wrong sender, filename, or legal identity', () => {
  const text = `
    GLS General Logistics Systems
    Hungary Csomag-Logisztikai Kft.
    CSOMAGSZÁM: 03408405000
    ÖSSZEG: 7450,00
    TRANZAKCIÓS SZÁM: 20260713112151670000
  `;

  const wrongSender = collectPdfPaymentTechnicalEvidenceV1({
    senderDomains: ['example.test'],
    filename: 'paymentReceipt_3408405000.pdf',
    text,
  });
  assert.deepEqual(wrongSender.evidence, []);

  const wrongFilename = collectPdfPaymentTechnicalEvidenceV1({
    senderDomains: ['gls-hungary.com'],
    filename: 'document.pdf',
    text,
  });
  assert.deepEqual(wrongFilename.evidence, []);

  const missingIdentity = collectPdfPaymentTechnicalEvidenceV1({
    senderDomains: ['gls-hungary.com'],
    filename: 'paymentReceipt_3408405000.pdf',
    text: 'CSOMAGSZÁM: 03408405000\nÖSSZEG: 7450,00\nTRANZAKCIÓS SZÁM: 20260713112151670000',
  });
  assert.deepEqual(missingIdentity.evidence, []);
});
