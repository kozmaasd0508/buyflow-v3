import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { BlindHoldoutV3TruthCase } from './blind-holdout-v3.js';
import { realGmailGroundTruthCaseId } from './real-gmail-ground-truth-v1.js';
import { measureTechnicalEvidenceOnRealGmailV15 } from './technical-evidence-real-gmail-measurement-v15.js';

function shopifyDocument(): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'PRIVATE-V15-ID-NEVER-REPORT',
    receivedAt: '2026-08-24T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'orders@merchant.example', name: 'Private Merchant' }],
      domains: ['merchant.example'],
      primaryEmail: 'orders@merchant.example',
      primaryDomain: 'merchant.example',
      primaryName: 'Private Merchant',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Rendelés (#21946) visszaigazolva',
    text: 'Rendelés: #21946\nKöszönjük, hogy nálunk vásároltál!\nÉrtesítünk majd, ha feladtuk a küldeményt.',
    html: '<a href="https://merchant.example/orders/status">View order</a><img src="https://cdn.shopify.com/s/files/1/product.png" class="order-list__product-image"><td class="order-list__product-description-cell">Product</td>',
    headers: [
      { name: 'Received', value: 'from o12.mailer.shopify.com' },
      { name: 'Message-ID', value: '<opaque@shopify.com>' },
      { name: 'Feedback-ID', value: 's_123:shopify' },
    ],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [], amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
  };
}

function truth(caseId: string): BlindHoldoutV3TruthCase {
  const na = { state: 'not_applicable' as const };
  return {
    caseId,
    isCommerceEvent: true,
    fields: {
      eventType: { state: 'known', value: 'order_created' },
      merchant: { state: 'unknown' },
      orderNumber: { state: 'known', value: '21946' },
      total: { state: 'unknown' },
      currency: { state: 'unknown' },
      carrier: na,
      trackingNumber: na,
      paymentStatus: { state: 'unknown' },
      invoiceNumber: na,
      paymentReference: na,
      products: { state: 'unknown' },
    },
  };
}

test('v1.5 real-Gmail measurement uses the executable v1.5 collector and leaks no raw values', () => {
  const caseId = realGmailGroundTruthCaseId('gmail:PRIVATE-V15-ID-NEVER-REPORT');
  const report = measureTechnicalEvidenceOnRealGmailV15({
    cases: [{ caseId, document: shopifyDocument(), truth: truth(caseId) }],
  });

  assert.equal(report.version, 'technical-evidence-real-gmail-measurement-v1.5');
  assert.equal(report.collectorVersion, '1.5.0');
  assert.equal(report.datasetClass, 'development_ground_truth');
  assert.equal(report.mode, 'shadow-measurement');
  assert.equal(report.productionWrites, 0);
  assert.equal(report.aiCalls, 0);
  assert.equal(report.cases, 1);
  assert.equal(report.casesWithAnyTechnicalEvidence, 1);
  assert.equal(report.casesWithCommerceTechnicalEvidence, 1);
  assert.equal(report.casesWithIdentifierEvidence, 1);
  assert.equal(report.fields.eventType?.exactSupport, 1);
  assert.equal(report.fields.orderNumber?.exactSupport, 1);
  assert.equal(report.rows[0]?.namespacesPresent.includes('MERCHANT:merchant.example'), true);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('PRIVATE-V15-ID-NEVER-REPORT'), false);
  assert.equal(serialized.includes('orders@merchant.example'), false);
  assert.equal(serialized.includes('21946'), false);
  assert.equal(serialized.includes(caseId), true);
});

test('v1.5 real-Gmail measurement rejects empty input', () => {
  assert.throws(() => measureTechnicalEvidenceOnRealGmailV15({ cases: [] }), /technical_evidence_real_gmail_v15_empty/);
});
