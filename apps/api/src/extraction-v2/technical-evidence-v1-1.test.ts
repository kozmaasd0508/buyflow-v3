import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import {
  collectTechnicalEvidenceV11,
  extractAlternateLanguageEvidenceV11,
  extractCompositeHeaderEventEvidenceV11,
  summarizeTechnicalEvidenceV11,
} from './technical-evidence-v1-1.js';

function documentFixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas' as EmailDocumentV1['provider'],
    providerMessageId: 'opaque-v11-test-message',
    receivedAt: '2026-08-23T21:00:00.000Z',
    sender: {
      addresses: [],
      domains: ['example.test'],
      primaryEmail: null,
      primaryDomain: 'example.test',
      primaryName: null,
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Neutral subject',
    text: '',
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
    ...overrides,
  };
}

function hasEvidence(
  rows: ReturnType<typeof collectTechnicalEvidenceV11>['evidence'],
  kind: string,
  normalizedValue: string,
  extractorId?: string,
): boolean {
  return rows.some((row) => row.kind === kind
    && row.normalizedValue === normalizedValue
    && (!extractorId || row.extractorId === extractorId));
}

test('v1.1 maps exact composite order template tags without provider-specific branching', () => {
  const sent = extractCompositeHeaderEventEvidenceV11(documentFixture({
    headers: [{ name: 'X-Mailin-Tag', value: 'order-sent' }],
  }));
  const invoice = extractCompositeHeaderEventEvidenceV11(documentFixture({
    headers: [{ name: 'X-Template-Type', value: 'order-invoice' }],
  }));
  const unknown = extractCompositeHeaderEventEvidenceV11(documentFixture({
    headers: [{ name: 'X-Mailin-Tag', value: 'weekly-campaign' }],
  }));

  assert.ok(sent.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'));
  assert.ok(invoice.some((row) => row.kind === 'event' && row.normalizedValue === 'invoice_or_receipt'));
  assert.deepEqual(unknown, []);
});

test('v1.1 extracts strict labelled English shipment identities and lifecycle semantics', () => {
  const processing = extractAlternateLanguageEvidenceV11(documentFixture({
    text: 'We had begun the processing of your parcel. The respective shipment was registered in our system with the following air waybill: 605855689091000013605231.',
  }));
  const outForDelivery = extractAlternateLanguageEvidenceV11(documentFixture({
    text: 'Our driver is going to deliver a shipment to you, which shipment is registered in our system with the following ID: 605855689091000013605231.',
  }));
  const delivered = extractAlternateLanguageEvidenceV11(documentFixture({
    text: 'The shipment sent from Example Store with the shipment ID 605855689091000013605231 has been delivered.',
  }));

  assert.ok(processing.some((row) => row.kind === 'tracking_number' && row.normalizedValue === '605855689091000013605231'));
  assert.ok(processing.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'));
  assert.ok(outForDelivery.some((row) => row.kind === 'tracking_number' && row.normalizedValue === '605855689091000013605231'));
  assert.ok(outForDelivery.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'));
  assert.ok(delivered.some((row) => row.kind === 'tracking_number' && row.normalizedValue === '605855689091000013605231'));
  assert.ok(delivered.some((row) => row.kind === 'event' && row.normalizedValue === 'delivery'));
});

test('v1.1 extracts labelled order and invoice identifiers but refuses bare generic id/ref', () => {
  const positive = extractAlternateLanguageEvidenceV11(documentFixture({
    text: 'Order number: ORD-12345. Invoice number: INV-98765.',
  }));
  const negative = extractAlternateLanguageEvidenceV11(documentFixture({
    text: 'Reference: 605855689091000013605231. ID: 123456789. Click here for details.',
  }));

  assert.ok(positive.some((row) => row.kind === 'order_number' && row.normalizedValue === 'ORD-12345'));
  assert.ok(positive.some((row) => row.kind === 'invoice_number' && row.normalizedValue === 'INV-98765'));
  assert.equal(negative.some((row) => row.kind === 'tracking_number' || row.kind === 'order_number' || row.kind === 'invoice_number'), false);
});

test('v1.1 ignores quoted/forwarded history and remains 0-write 0-AI', () => {
  const document = documentFixture({
    headers: [{ name: 'X-Mailin-Tag', value: 'order-sent' }],
    text: `Current neutral note.\n\n----- Forwarded message -----\nThe shipment with shipment ID 605855689091000013605231 has been delivered.`,
  });
  const before = JSON.stringify(document);
  const result = collectTechnicalEvidenceV11(document);

  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.collectorVersion, '1.1.0');
  assert.equal(JSON.stringify(document), before);
  assert.ok(hasEvidence(result.evidence, 'event', 'shipment', 'composite-header-event-v1.1'));
  assert.equal(hasEvidence(result.evidence, 'tracking_number', '605855689091000013605231', 'alternate-language-evidence-v1.1'), false);
  assert.equal(hasEvidence(result.evidence, 'event', 'delivery', 'alternate-language-evidence-v1.1'), false);

  const summary = summarizeTechnicalEvidenceV11(result);
  assert.equal(summary.productionWrites, 0);
  assert.equal(summary.aiCalls, 0);
  assert.equal(summary.collectorVersion, '1.1.0');
});
