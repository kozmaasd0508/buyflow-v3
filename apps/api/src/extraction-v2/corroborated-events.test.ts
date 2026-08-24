import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { deriveCorroboratedEventEvidence } from './corroborated-event-evidence.js';
import { universalMerchantExtractor } from './merchant-extractor.js';
import type { EvidenceBundle } from './types.js';

function document(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'test-message',
    receivedAt: '2026-08-22T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'shop@example.com', name: 'Example Store' }],
      domains: ['example.com'],
      primaryEmail: 'shop@example.com',
      primaryDomain: 'example.com',
      primaryName: 'Example Store',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: null,
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

test('refunded payment evidence corroborates refund event without legacy parser input', () => {
  const bundle: EvidenceBundle = {
    claims: [{
      field: 'payment_status',
      value: 'refunded',
      confidence: 0.995,
      source: 'body',
      extractorId: 'test',
      extractorVersion: 'v1',
      qualifiers: ['explicit_refund_completion'],
    }],
  };
  const claims = deriveCorroboratedEventEvidence(document(), bundle);
  assert.ok(claims.some((claim) => claim.field === 'event_type' && claim.value === 'refund'));
});

test('invoice attachment can corroborate invoice event without broad keyword classification', () => {
  const claims = deriveCorroboratedEventEvidence(document({
    attachments: [{
      id: 'a1',
      filename: 'szamla_4009028516.pdf',
      contentType: 'application/pdf',
    }],
  }), { claims: [] });
  assert.ok(claims.some((claim) => claim.field === 'event_type' && claim.value === 'invoice_or_receipt'));
});

test('plain invoice word alone does not create corroborated invoice event', () => {
  const claims = deriveCorroboratedEventEvidence(document({
    text: 'Az invoice beállításokról szóló tájékoztató.',
  }), { claims: [] });
  assert.equal(claims.length, 0);
});

test('personal sender name remains weak even when order structure exists', () => {
  const claims = universalMerchantExtractor.extract(document({
    sender: {
      addresses: [{ email: 'gaborne@gmail.com', name: 'Gáborné Kozma' }],
      domains: ['gmail.com'],
      primaryEmail: 'gaborne@gmail.com',
      primaryDomain: 'gmail.com',
      primaryName: 'Gáborné Kozma',
    },
    signals: {
      orderNumbers: ['3010410391'],
      amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
  }));
  const merchant = claims.find((claim) => claim.field === 'merchant');
  assert.equal(merchant?.confidence, 0.68);
  assert.ok(merchant?.qualifiers?.includes('sender_display_name_fallback'));
});

test('personal byline sender remains weak even when domain matches a shop brand', () => {
  const claims = universalMerchantExtractor.extract(document({
    sender: {
      addresses: [{ email: 'adam@lampaesfeny.hu', name: 'Ádám a lampaesfeny' }],
      domains: ['lampaesfeny.hu'],
      primaryEmail: 'adam@lampaesfeny.hu',
      primaryDomain: 'lampaesfeny.hu',
      primaryName: 'Ádám a lampaesfeny',
    },
    signals: {
      orderNumbers: ['ABC-1234'],
      amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
  }));
  const merchant = claims.find((claim) => claim.field === 'merchant');
  assert.equal(merchant?.confidence, 0.68);
});

test('commercial sender identity can resolve when domain corroborates it', () => {
  const claims = universalMerchantExtractor.extract(document({
    sender: {
      addresses: [{ email: 'orders@sportvision.hu', name: 'Sportvision' }],
      domains: ['sportvision.hu'],
      primaryEmail: 'orders@sportvision.hu',
      primaryDomain: 'sportvision.hu',
      primaryName: 'Sportvision',
    },
    signals: {
      orderNumbers: ['130354'],
      amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
  }));
  const merchant = claims.find((claim) => claim.field === 'merchant');
  assert.equal(merchant?.confidence, 0.86);
  assert.ok(merchant?.qualifiers?.includes('sender_commercial_identity'));
});
