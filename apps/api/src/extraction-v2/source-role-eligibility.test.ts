import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailHeader, NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { runExtractionEngineV2 } from './engine-v2.js';

function email(input: {
  subject: string;
  snippet: string;
  sender?: string;
  senderName?: string;
  headers?: EmailHeader[];
}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `source-role-${Math.random()}`,
    subject: input.subject,
    from: [{ email: input.sender ?? 'shop@example.com', name: input.senderName ?? 'Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-23T00:00:00.000Z',
    snippet: input.snippet,
    headers: input.headers,
    folders: ['inbox'],
    attachments: [],
  };
}

const dkimPass = (domain: string): EmailHeader => ({
  name: 'Authentication-Results',
  value: `mx.google.com; dkim=pass header.d=${domain}`,
});

test('direct carrier source cannot resolve raw retail order_created evidence', () => {
  const document = buildEmailDocumentV1(email({
    sender: 'webcas@expressone.hu',
    senderName: 'Express One',
    subject: 'Megrendelés visszaigazolása #772013',
    snippet: [
      'Köszönjük a megrendelést.',
      'Megrendelés visszaigazolása #772013',
      'Az árufelvételi megbízást a futár elfogadta.',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);

  assert.equal(result.resolved.carrier.value, 'Express One');
  assert.equal(result.resolved.eventType.value, null);
  assert.ok(result.evidence.bundle.claims.some((claim) => (
    claim.field === 'event_type' && claim.value === 'order_created'
  )));
});

test('the same strong order wording remains eligible for a normal merchant source', () => {
  const document = buildEmailDocumentV1(email({
    sender: 'orders@merchant-example.hu',
    senderName: 'Merchant Example',
    subject: 'Rendelés visszaigazolása',
    snippet: [
      'Köszönjük a megrendelést.',
      'Rendelés száma: ORD-12345',
    ].join('\n'),
  }));

  const result = runExtractionEngineV2(document);
  assert.equal(result.resolved.eventType.value, 'order_created');
  assert.equal(result.resolved.orderNumber.value, 'ORD-12345');
});

test('authenticated direct carrier shipment and delivery lifecycle remains eligible', () => {
  const shipmentDocument = buildEmailDocumentV1(email({
    sender: 'notify@expressone.hu',
    senderName: 'Express One',
    headers: [dkimPass('expressone.hu')],
    subject: 'Küldemény feldolgozása megkezdődött',
    snippet: 'Küldeményének feldolgozását megkezdtük a központi raktárunkban.',
  }));
  const shipment = runExtractionEngineV2(shipmentDocument);
  assert.equal(shipment.resolved.eventType.value, 'shipment');

  const deliveryDocument = buildEmailDocumentV1(email({
    sender: 'notify@dpd.hu',
    senderName: 'DPD',
    headers: [dkimPass('dpd.hu')],
    subject: 'Sikeres kézbesítés',
    snippet: 'Küldeményét a mai napon sikeresen kézbesítettük.',
  }));
  const delivery = runExtractionEngineV2(deliveryDocument);
  assert.equal(delivery.resolved.eventType.value, 'delivery');
});
