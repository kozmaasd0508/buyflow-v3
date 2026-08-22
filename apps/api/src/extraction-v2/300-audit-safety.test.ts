import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { runExtractionEngineV2 } from './engine-v2.js';

function email(input: {
  subject: string;
  snippet: string;
  sender?: string;
  headers?: NormalizedEmail['headers'];
}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `audit-300-safety-${Math.random()}`,
    subject: input.subject,
    from: [{ email: input.sender ?? 'support@example.com', name: 'Sender' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T22:00:00.000Z',
    snippet: input.snippet,
    ...(input.headers ? { headers: input.headers } : {}),
    folders: ['inbox'],
    attachments: [],
  };
}

test('matching DKIM pass allows additive direct-carrier lifecycle evidence', () => {
  const document = buildEmailDocumentV1(email({
    sender: 'ertesites@expressone.hu',
    subject: 'Kézbesítési értesítő',
    snippet: 'A küldemény feldolgozását megkezdtük a központi raktárban.',
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.example; dkim=pass header.d=expressone.hu; spf=pass',
    }],
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.carrier.value, 'Express One');
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.ok(result.resolved.eventType.provenance.some((claim) => (
    claim.source === 'provider_adapter'
    && claim.qualifiers?.includes('direct_carrier_shipment_event')
  )));
  assert.ok(result.resolved.carrier.provenance.some((claim) => (
    claim.source === 'provider_adapter'
    && claim.qualifiers?.includes('authenticated_direct_carrier_sender')
  )));
});

test('sender domain without matching DKIM cannot source-promote a carrier lifecycle event', () => {
  const document = buildEmailDocumentV1(email({
    sender: 'ertesites@expressone.hu',
    subject: 'Általános értesítő',
    snippet: 'Tájékoztató üzenet az ügyfél részére.',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.carrier.value, 'Express One');
  assert.equal(result.resolved.eventType.value, null);
  assert.ok(!result.evidence.bundle.claims.some((claim) => (
    claim.field === 'event_type' && claim.source === 'provider_adapter'
  )));
});

test('processed refund request is not treated as completed refund', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Refund request update',
    snippet: 'Your refund request has been processed by our support team. We will review eligibility next.',
  }));

  const result = runExtractionEngineV2(document);
  assert.notEqual(result.resolved.eventType.value, 'refund');
  assert.notEqual(result.resolved.paymentStatus.value, 'refunded');
});

test('customer asking support to process cancellation and refund is not refunded', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Re: [Replit] Re: Refund request #503830',
    snippet: [
      'Hello Quinn,',
      'Yes, I confirm that I would like to proceed with the cancellation of my Core subscription and receive the refund.',
      'Please process the cancellation and refund.',
      'Thank you for your help.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.notEqual(result.resolved.eventType.value, 'refund');
  assert.notEqual(result.resolved.paymentStatus.value, 'refunded');
});

test('refund eligibility and cancellation prerequisite are not completed refund evidence', () => {
  const document = buildEmailDocumentV1(email({
    subject: '[Replit] Re: Refund request #503830',
    snippet: [
      'Your monthly Core subscription is within the 30-day refund window, so a refund is possible.',
      'A subscription refund requires cancelling the subscription.',
      'Once cancelled, your account will move to the free Starter plan.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.notEqual(result.resolved.eventType.value, 'refund');
  assert.notEqual(result.resolved.paymentStatus.value, 'refunded');
});

test('initial customer refund request is not completed refund evidence', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Refund request',
    snippet: [
      'Hello Replit Support,',
      'I would like to request a refund for my recent Replit subscription/payment.',
      'Please cancel the subscription and refund the amount charged to my payment method.',
      'Please confirm once the cancellation and refund have been processed.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.notEqual(result.resolved.eventType.value, 'refund');
  assert.notEqual(result.resolved.paymentStatus.value, 'refunded');
});

test('issued refund still resolves when completion is stated inside one current sentence', () => {
  const document = buildEmailDocumentV1(email({
    subject: '[Replit] Re: Refund request #503830',
    snippet: 'Your monthly Core subscription has been cancelled and a refund for your last payment has been issued.',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'refund');
  assert.equal(result.resolved.paymentStatus.value, 'refunded');
});

test('quoted completed refund cannot promote a new current-message refund request', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Re: Refund request #503830',
    snippet: [
      'Thanks. I have one more question about the refund request.',
      'On Sat, Aug 22, 2026 at 10:00 PM Support <support@example.com> wrote:',
      'Your refund for the last payment has been issued.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.notEqual(result.resolved.eventType.value, 'refund');
  assert.notEqual(result.resolved.paymentStatus.value, 'refunded');
});

test('explicit refund receipt subject is settled refund evidence, not a generic receipt event', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Your refund from Example Shop #3401-6095',
    snippet: 'Amount refunded $25.40. A receipt is attached for your records.',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'refund');
  assert.equal(result.resolved.paymentStatus.value, 'refunded');
});

test('generic Hungarian shipment labels resolve tracking without provider-specific logic', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A csomagod úton van',
    snippet: 'Szállítási mód: Express One\nKüldemény száma: 605855689091000013605231',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.carrier.value, 'Express One');
  assert.equal(result.resolved.trackingNumber.value, '605855689091000013605231');
  assert.ok(result.resolved.trackingNumber.provenance.some((claim) => (
    claim.qualifiers?.includes('explicit_tracking_label')
  )));
});

test('unique long identifier may become tracking only after shipment and carrier corroboration', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A csomagod úton van',
    snippet: 'A csomagot a futár átvette. Szállítási mód: Express One\n605855689091000013605231',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'shipment');
  assert.equal(result.resolved.carrier.value, 'Express One');
  assert.equal(result.resolved.trackingNumber.value, '605855689091000013605231');
  assert.ok(result.resolved.trackingNumber.provenance.some((claim) => (
    claim.extractorId === 'corroborated-tracking-evidence'
  )));
});

test('bare long identifier is not tracking without shipment and carrier evidence', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'Account reference',
    snippet: 'Administrative identifier: 605855689091000013605231',
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.trackingNumber.value, null);
});

test('multiple long transport identifiers stay unresolved instead of guessing tracking', () => {
  const document = buildEmailDocumentV1(email({
    subject: 'A csomagod úton van',
    snippet: [
      'Szállítási mód: Express One',
      '605855689091000013605231',
      '605855689091000013605232',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.trackingNumber.value, null);
});
