import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { BlindHoldoutV3TruthCase } from './blind-holdout-v3.js';
import {
  evaluateRealGmailGroundTruthV1,
  realGmailGroundTruthCaseId,
} from './real-gmail-ground-truth-v1.js';

function privateDocument(): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas',
    providerMessageId: 'PRIVATE-GMAIL-MESSAGE-ID-DO-NOT-LEAK',
    receivedAt: '2026-08-23T19:00:00.000Z',
    sender: {
      addresses: [{ email: 'private.sender@example.test', name: 'Private Sender' }],
      domains: ['example.test'],
      primaryEmail: 'private.sender@example.test',
      primaryDomain: 'example.test',
      primaryName: 'Private Sender',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'PRIVATE SUBJECT DO NOT LEAK',
    text: 'Personal note without commerce markers. PRIVATE BODY DO NOT LEAK.',
    html: null,
    headers: [],
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

function nonCommerceTruth(caseId: string): BlindHoldoutV3TruthCase {
  const notApplicable = { state: 'not_applicable' as const };
  return {
    caseId,
    isCommerceEvent: false,
    fields: {
      eventType: notApplicable,
      merchant: notApplicable,
      orderNumber: notApplicable,
      total: notApplicable,
      currency: notApplicable,
      carrier: notApplicable,
      trackingNumber: notApplicable,
      paymentStatus: notApplicable,
      invoiceNumber: notApplicable,
      paymentReference: notApplicable,
      products: notApplicable,
    },
  };
}

test('evaluates a private Gmail case with the real Extraction Engine v2 and leaks no raw mail data', () => {
  const privateSourceKey = 'gmail:PRIVATE-GMAIL-MESSAGE-ID-DO-NOT-LEAK';
  const caseId = realGmailGroundTruthCaseId(privateSourceKey);
  const report = evaluateRealGmailGroundTruthV1({
    cases: [{
      caseId,
      document: privateDocument(),
      truth: nonCommerceTruth(caseId),
    }],
  });

  assert.equal(report.version, 'real-gmail-ground-truth-v1');
  assert.equal(report.datasetClass, 'development_ground_truth');
  assert.equal(report.extractionEngineVersion, 'extraction-engine-v2-shadow');
  assert.equal(report.productionWrites, 0);
  assert.equal(report.aiCalls, 0);
  assert.equal(report.cases, 1);
  assert.equal(report.detection.tn, 1);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(privateSourceKey), false);
  assert.equal(serialized.includes('PRIVATE-GMAIL-MESSAGE-ID-DO-NOT-LEAK'), false);
  assert.equal(serialized.includes('PRIVATE SUBJECT DO NOT LEAK'), false);
  assert.equal(serialized.includes('PRIVATE BODY DO NOT LEAK'), false);
  assert.equal(serialized.includes('private.sender@example.test'), false);
  assert.equal(serialized.includes(caseId), true);
});

test('rejects non-opaque case ids before evaluation', () => {
  assert.throws(() => evaluateRealGmailGroundTruthV1({
    cases: [{
      caseId: 'raw-gmail-id',
      document: privateDocument(),
      truth: nonCommerceTruth('raw-gmail-id'),
    }],
  }), /real_gmail_gt_case_id_must_be_opaque_sha256/);
});
