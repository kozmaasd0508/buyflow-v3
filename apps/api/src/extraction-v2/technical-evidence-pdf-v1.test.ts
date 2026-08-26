import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPdfTechnicalEvidenceV1 } from './technical-evidence-pdf-v1.js';

test('PDF TechnicalEvidence v1 converts verified invoice/order references into shadow evidence', () => {
  const result = collectPdfTechnicalEvidenceV1({
    senderDomains: ['jatekbolt.hu'],
    filename: 'INV_TEST_001.pdf',
    text: `
      Számla
      Bizonylatszám TEST_2026_001
      Rendelésszám JB12345678
      Szállító
      MODELL & HOBBY Kft.
      Weboldal www.jatekbolt.hu
    `,
  });

  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.evidence.length, 3);

  const invoice = result.evidence.find((row) => row.kind === 'invoice_number');
  const order = result.evidence.find((row) => row.kind === 'order_number');
  const event = result.evidence.find((row) => row.kind === 'event');

  assert.equal(invoice?.normalizedValue, 'TEST_2026_001');
  assert.equal(invoice?.namespace, 'JATEKBOLT');
  assert.equal(order?.normalizedValue, '12345678');
  assert.equal(order?.namespace, 'JATEKBOLT');
  assert.equal(event?.normalizedValue, 'invoice_or_receipt');
  assert.ok(result.evidence.every((row) => row.source === 'pdf'));
  assert.ok(result.evidence.every((row) => row.confidence >= 0.99));
});

test('PDF TechnicalEvidence v1 fails closed on ambiguous/untyped PDF text', () => {
  const result = collectPdfTechnicalEvidenceV1({
    senderDomains: ['example.test'],
    filename: 'document.pdf',
    text: 'Thank you. Reference: 123456. Total: 9990 HUF.',
  });

  assert.deepEqual(result.evidence, []);
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
});

test('PDF TechnicalEvidence v1 refuses non-PDF filename even when labels look plausible', () => {
  const result = collectPdfTechnicalEvidenceV1({
    senderDomains: ['example.test'],
    filename: 'invoice.txt',
    text: 'Invoice number: INV-12345\nOrder number: ORD-56789\nInvoice',
  });

  assert.deepEqual(result.evidence, []);
});
