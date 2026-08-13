import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { filterCommerceEmail } from './commerce-email-filter.js';
import {
  detectCarrierFromDomains,
  extractLabeledTrackingNumber,
  parseDeterministicCommerceEmail,
} from './deterministic-commerce-parser.js';

function email(overrides: Partial<NormalizedEmail>): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'm1',
    receivedAt: '2026-08-12T10:00:00.000Z',
    from: [{ email: 'hello@example.com' }],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
    ...overrides,
  };
}

test('accepts Gmail purchases category without keyword guessing', () => {
  const result = filterCommerceEmail(email({ folders: ['INBOX', 'CATEGORY_PURCHASES'] }));
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('gmail_category_purchases'));
});

test('accepts known carrier sender', () => {
  const result = filterCommerceEmail(email({ from: [{ email: 'notify@expressone.hu' }] }));
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('known_carrier_sender'));
});

test('accepts schema.org commerce markup', () => {
  const result = filterCommerceEmail(email({
    bodyHtml: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Order"}</script>',
  }));
  assert.equal(result.relevant, true);
  assert.deepEqual(result.commerceMarkupTypes, ['Order']);
});

test('ignores clearly unrelated email', () => {
  const result = filterCommerceEmail(email({ subject: 'Weekly team notes', snippet: 'Meeting recap' }));
  assert.equal(result.relevant, false);
  assert.deepEqual(result.reasons, []);
});

test('detects supported carrier sender domains', () => {
  assert.equal(detectCarrierFromDomains(['email.gls-hungary.com']), 'GLS');
  assert.equal(detectCarrierFromDomains(['notify.expressone.hu']), 'Express One');
  assert.equal(detectCarrierFromDomains(['mail.dpd.com']), 'DPD');
  assert.equal(detectCarrierFromDomains(['notify.dhl.com']), 'DHL');
  assert.equal(detectCarrierFromDomains(['ups.com']), 'UPS');
  assert.equal(detectCarrierFromDomains(['shop.example.com']), null);
});

test('extracts only explicitly labelled tracking identifiers', () => {
  assert.equal(
    extractLabeledTrackingNumber('Csomagszám: 12345678901'),
    '12345678901',
  );
  assert.equal(
    extractLabeledTrackingNumber('Tracking number: 1Z999AA10123456784'),
    '1Z999AA10123456784',
  );
  assert.equal(
    extractLabeledTrackingNumber('Rendelésszám: 12345678901'),
    null,
  );
});

test('parses a clear GLS shipment without AI', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['email.gls-hungary.com'],
    subject: 'Csomagját átvettük szállításra',
    bodyText: 'Csomagszám: 12345678901',
  });

  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.carrier, 'GLS');
  assert.equal(result.extraction.tracking_number, '12345678901');
  assert.equal(result.extraction.confidence, 0.96);
  assert.equal(result.extraction.order_number, null);
});

test('recognizes an explicitly completed delivery', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dpd.com'],
    subject: 'Csomagja sikeresen kézbesítve',
    bodyText: 'Küldeményazonosító: 12345678901234',
  });

  assert.ok(result);
  assert.equal(result.extraction.event_type, 'delivery');
});

test('does not treat out-for-delivery wording as already delivered', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dhl.com'],
    subject: 'Out for delivery',
    bodyText: 'Tracking number: 1234567890',
  });

  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
});

test('falls back when carrier or labelled tracking evidence is missing', () => {
  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['shop.example.com'],
    subject: 'Tracking number: 12345678901',
  }), null);

  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['email.gls-hungary.com'],
    subject: 'A csomag úton van',
    bodyText: 'Rendelésszám: 12345678901',
  }), null);
});
