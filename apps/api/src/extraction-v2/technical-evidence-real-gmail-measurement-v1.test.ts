import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { BlindHoldoutV3TruthCase } from './blind-holdout-v3.js';
import { realGmailGroundTruthCaseId } from './real-gmail-ground-truth-v1.js';
import { measureTechnicalEvidenceOnRealGmailV1 } from './technical-evidence-real-gmail-measurement-v1.js';

function document(): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas',
    providerMessageId: 'PRIVATE-ID-NEVER-REPORT',
    receivedAt: '2026-08-23T20:00:00.000Z',
    sender: {
      addresses: [{ email: 'private@example.test', name: 'Private' }],
      domains: ['example.test'],
      primaryEmail: 'private@example.test',
      primaryDomain: 'example.test',
      primaryName: 'Private',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Opaque order',
    text: 'No visible commerce labels are required for this test.',
    html: '<html><head><title>Order Confirmation</title></head><body><a href="https://shop.example.test/order/ABC12345">view</a></body></html>',
    headers: [
      { name: 'Authentication-Results', value: 'dkim=pass header.d=example.test' },
      { name: 'X-Order-Number', value: 'ABC12345' },
    ],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
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
      orderNumber: { state: 'known', value: 'ABC12345' },
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

test('measures exact technical support and baseline rescue without raw mail leakage', () => {
  const caseId = realGmailGroundTruthCaseId('gmail:PRIVATE-ID-NEVER-REPORT');
  const report = measureTechnicalEvidenceOnRealGmailV1({
    cases: [{ caseId, document: document(), truth: truth(caseId) }],
  });

  assert.equal(report.version, 'technical-evidence-real-gmail-measurement-v1');
  assert.equal(report.datasetClass, 'development_ground_truth');
  assert.equal(report.productionWrites, 0);
  assert.equal(report.aiCalls, 0);
  assert.equal(report.cases, 1);
  assert.equal(report.casesWithAnyTechnicalEvidence, 1);
  assert.equal(report.casesWithCommerceTechnicalEvidence, 1);
  assert.equal(report.casesWithIdentifierEvidence, 1);
  assert.equal(report.fields.eventType?.exactSupport, 1);
  assert.equal(report.fields.orderNumber?.exactSupport, 1);
  assert.equal(report.rows[0]?.exactSupportedFields.includes('eventType'), true);
  assert.equal(report.rows[0]?.exactSupportedFields.includes('orderNumber'), true);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('PRIVATE-ID-NEVER-REPORT'), false);
  assert.equal(serialized.includes('private@example.test'), false);
  assert.equal(serialized.includes('ABC12345'), false);
  assert.equal(serialized.includes(caseId), true);
});

test('rejects empty measurements', () => {
  assert.throws(() => measureTechnicalEvidenceOnRealGmailV1({ cases: [] }), /technical_evidence_real_gmail_empty/);
});
