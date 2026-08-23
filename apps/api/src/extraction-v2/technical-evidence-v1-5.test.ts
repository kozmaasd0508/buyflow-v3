import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectTechnicalEvidenceV15, summarizeTechnicalEvidenceV15 } from './technical-evidence-v1-5.js';

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'opaque-v15-test',
    receivedAt: '2026-08-24T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'store@example.test' }],
      domains: ['example.test'],
      primaryEmail: 'store@example.test',
      primaryDomain: 'example.test',
      primaryName: 'Example',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Neutral',
    text: '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [], amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
    ...overrides,
  };
}

test('v1.5 is one executable shadow entry point over v1.2 plus carrier evidence', () => {
  const result = collectTechnicalEvidenceV15({
    document: fixture({
      sender: {
        addresses: [{ email: 'notice@dpd.hu' }],
        domains: ['dpd.hu'],
        primaryEmail: 'notice@dpd.hu',
        primaryDomain: 'dpd.hu',
        primaryName: 'DPD',
      },
      subject: 'Értesítés 16380143879559 küldemény mai kézbesítéséről',
      text: 'A 16380143879559 küldeményt futárunk a mai napon kézbesítésre átvette.',
    }),
  });

  assert.equal(result.collectorVersion, '1.5.0');
  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'carrier' && row.namespace === 'DPD'));
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === '16380143879559'
    && row.namespace === 'DPD'));
  assert.ok(result.ranExtractors.some((run) => run.id === 'carrier-semantic-evidence-v1'));
  assert.ok(result.ranExtractors.some((run) => run.id === 'platform-semantic-evidence-v1.2'));
});

test('v1.5 composes native Shopify lifecycle evidence without granting a carrier namespace', () => {
  const result = collectTechnicalEvidenceV15({
    document: fixture({
      subject: 'Küldemény kézbesítve (rendelés: #32001)',
      text: 'Rendelés: #32001\nKüldemény kézbesítve\nFAMA fuvarlevélszám: 243961796883300013600000',
      html: `
        <a href="https://merchant.example/_t/c/v3/opaque">Rendelés megtekintése</a>
        <img src="https://cdn.shopify.com/s/files/1/product.png" class="order-list__product-image">
        <td class="order-list__product-description-cell">Product</td>
      `,
      headers: [
        { name: 'Received', value: 'from o19.mailer.shopify.com' },
        { name: 'DKIM-Signature', value: 'v=1; d=t.shopifyemail.com; s=s1' },
        { name: 'Return-Path', value: '<bounce@mailer.t.shopifyemail.com>' },
      ],
    }),
  });

  assert.ok(result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'delivery'));
  assert.ok(result.evidence.some((row) => row.kind === 'order_number'
    && row.normalizedValue === '32001'
    && row.namespace === 'MERCHANT:example.test'));
  const tracking = result.evidence.find((row) => row.kind === 'tracking_number'
    && row.normalizedValue === '243961796883300013600000');
  assert.ok(tracking);
  assert.equal(tracking?.namespace, undefined);
});

test('v1.5 adds verified PDF invoice evidence using document sender namespace', () => {
  const result = collectTechnicalEvidenceV15({
    document: fixture({
      sender: {
        addresses: [{ email: 'orders@jatekbolt.hu' }],
        domains: ['jatekbolt.hu'],
        primaryEmail: 'orders@jatekbolt.hu',
        primaryDomain: 'jatekbolt.hu',
        primaryName: 'JatekBolt',
      },
    }),
    pdfAttachments: [{
      filename: 'INV_TEST_001.pdf',
      text: `
        Számla
        Bizonylatszám TEST_2026_001
        Rendelésszám JB12345678
        Szállító
        MODELL & HOBBY Kft.
        Weboldal www.jatekbolt.hu
      `,
    }],
  });

  assert.ok(result.evidence.some((row) => row.kind === 'invoice_number'
    && row.normalizedValue === 'TEST_2026_001'
    && row.namespace === 'JATEKBOLT'
    && row.source === 'pdf'));
  assert.ok(result.evidence.some((row) => row.kind === 'order_number'
    && row.normalizedValue === '12345678'
    && row.namespace === 'JATEKBOLT'
    && row.source === 'pdf'));
});

test('v1.5 adds provider-qualified GLS COD PDF payment and shipment identity evidence', () => {
  const result = collectTechnicalEvidenceV15({
    document: fixture({
      sender: {
        addresses: [{ email: 'noreply@gls-hungary.com' }],
        domains: ['gls-hungary.com'],
        primaryEmail: 'noreply@gls-hungary.com',
        primaryDomain: 'gls-hungary.com',
        primaryName: 'GLS',
      },
    }),
    pdfAttachments: [{
      filename: 'paymentReceipt_03408405568.pdf',
      text: `
        GLS General Logistics Systems
        Hungary Csomag-Logisztikai Kft
        CSOMAGSZÁM: 03408405568
        ÖSSZEG: 7450,00
        TRANZAKCIÓS SZÁM: 20260713112151676605
      `,
    }],
  });

  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === '3408405568'
    && row.namespace === 'GLS'));
  assert.ok(result.evidence.some((row) => row.kind === 'payment_reference'
    && row.normalizedValue === '20260713112151676605'
    && row.namespace === 'GLS_COD'));
  assert.ok(result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'payment_completed'));
});

test('v1.5 ignores non-PDF supplied attachment text and preserves zero-write zero-AI invariants', () => {
  const result = collectTechnicalEvidenceV15({
    document: fixture(),
    pdfAttachments: [{
      filename: 'invoice.txt',
      text: 'Számla Bizonylatszám X12345 Rendelésszám Y67890',
    }],
  });
  const summary = summarizeTechnicalEvidenceV15(result, 0);

  assert.equal(result.evidence.some((row) => row.source === 'pdf'), false);
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(summary.productionWrites, 0);
  assert.equal(summary.aiCalls, 0);
  assert.equal(summary.pdfAttachmentsProcessed, 0);
});
