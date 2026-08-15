import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInvoiceAttachmentText } from './invoice-attachment-parser.js';

const jatekboltPdfText = [
  'Számla',
  'Bizonylatszám S26_044783',
  'Rendelésszám JB12247833',
  'Szállító',
  'MODELL & HOBBY Kft.',
  'Összesen 37 991 10 257 48 248',
  'Weboldal www.jatekbolt.hu',
].join('\n');

test('parses Jatekbolt invoice PDF and normalizes JB order prefix', () => {
  const parsed = parseInvoiceAttachmentText({
    senderDomains: ['jatekbolt.hu'],
    filename: 'S26_044783.pdf',
    text: jatekboltPdfText,
  });

  assert.ok(parsed);
  assert.equal(parsed.invoiceNumber, 'S26_044783');
  assert.equal(parsed.orderNumber, '12247833');
  assert.equal(parsed.documentType, 'invoice');
  assert.equal(parsed.confidence, 0.995);
  assert.equal(parsed.parserVersion, 'pdf-invoice-v1');
  assert.ok(parsed.reasons.includes('verified_jatekbolt_legal_identity'));
});

test('parses a generic merchant-owned invoice with explicit invoice and order labels', () => {
  const parsed = parseInvoiceAttachmentText({
    senderDomains: ['shop.example'],
    filename: 'invoice.pdf',
    text: 'Invoice number INV-2026-991\nOrder number WEB-88421\nInvoice total: 120.00 EUR',
  });

  assert.ok(parsed);
  assert.equal(parsed.invoiceNumber, 'INV-2026-991');
  assert.equal(parsed.orderNumber, 'WEB-88421');
  assert.ok(parsed.confidence >= 0.97);
});

test('Jatekbolt PDF requires its legal identity and business domain inside the document', () => {
  assert.equal(parseInvoiceAttachmentText({
    senderDomains: ['jatekbolt.hu'],
    filename: 'S26_044783.pdf',
    text: 'Számla\nBizonylatszám S26_044783\nRendelésszám JB12247833',
  }), null);
});

test('does not parse non-PDF files or documents without both identities', () => {
  assert.equal(parseInvoiceAttachmentText({
    senderDomains: ['shop.example'],
    filename: 'invoice.txt',
    text: 'Invoice number INV-1\nOrder number WEB-2',
  }), null);

  assert.equal(parseInvoiceAttachmentText({
    senderDomains: ['shop.example'],
    filename: 'invoice.pdf',
    text: 'Invoice number INV-1 only',
  }), null);
});
