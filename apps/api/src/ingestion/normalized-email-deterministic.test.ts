import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import {
  normalizedEmailToDeterministicInput,
  parseNormalizedDeterministicEmail,
} from './normalized-email-deterministic.js';

function carrierEmail(provider: 'nylas' | 'ses'): NormalizedEmail {
  return {
    provider,
    providerMessageId: `${provider}-message-1`,
    subject: 'Your parcel has been shipped',
    from: [{ email: 'noreply@gls-hungary.com', name: 'GLS' }],
    to: [{ email: 'bf-0123456789abcdef@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-18T17:40:00.000Z',
    bodyHtml: '<p>Tracking number: 12345678</p><p>Your parcel has been shipped.</p>',
    folders: provider === 'nylas' ? ['inbox'] : ['inbound'],
    attachments: [],
  };
}

test('converts a normalized SES email into deterministic parser input', () => {
  const input = normalizedEmailToDeterministicInput(carrierEmail('ses'));

  assert.deepEqual(input.senderDomains, ['gls-hungary.com']);
  assert.equal(input.subject, 'Your parcel has been shipped');
  assert.match(input.bodyText, /Tracking number: 12345678/);
});

test('SES and Nylas produce the same deterministic recognition result', () => {
  const ses = parseNormalizedDeterministicEmail(carrierEmail('ses'));
  const nylas = parseNormalizedDeterministicEmail(carrierEmail('nylas'));

  assert.ok(ses);
  assert.ok(nylas);
  assert.deepEqual(ses, nylas);
  assert.equal(ses.extraction.event_type, 'shipment');
  assert.equal(ses.extraction.carrier, 'GLS');
  assert.equal(ses.extraction.tracking_number, '12345678');
  assert.equal(ses.shipmentPhase, 'shipped');
});

test('uses the snippet when no HTML body is available', () => {
  const email = carrierEmail('ses');
  delete email.bodyHtml;
  email.snippet = 'Tracking number: 87654321\nShipment information received';

  const parsed = parseNormalizedDeterministicEmail(email);
  assert.ok(parsed);
  assert.equal(parsed.extraction.tracking_number, '87654321');
  assert.equal(parsed.shipmentPhase, 'shipment_created');
});
