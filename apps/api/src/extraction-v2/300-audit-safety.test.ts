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
