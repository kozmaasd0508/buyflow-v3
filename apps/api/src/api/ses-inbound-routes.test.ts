import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSesInboundBridgePayload,
  prepareSesInboundBridge,
  sesInboundRuntimeConfig,
  verifySesInboundSecret,
} from './ses-inbound-routes.js';

function notification(overrides: Record<string, unknown> = {}) {
  return {
    mail: {
      timestamp: '2026-08-18T18:10:00.000Z',
      messageId: 'ses-message-123',
      destination: ['kozma0508@buyflow.hu'],
      commonHeaders: {
        from: ['GLS <noreply@gls-hungary.com>'],
        to: ['kozma0508@buyflow.hu'],
        subject: 'Your parcel has been shipped',
      },
    },
    receipt: {
      timestamp: '2026-08-18T18:10:01.000Z',
      recipients: ['kozma0508@buyflow.hu'],
      spamVerdict: { status: 'PASS' },
      virusVerdict: { status: 'PASS' },
      spfVerdict: { status: 'PASS' },
      dkimVerdict: { status: 'PASS' },
      dmarcVerdict: { status: 'PASS' },
    },
    ...overrides,
  };
}

test('SES bridge is disabled by default and requires a long ingest secret', () => {
  assert.deepEqual(sesInboundRuntimeConfig({}), { enabled: false, secret: null });
  assert.deepEqual(
    sesInboundRuntimeConfig({ BUYFLOW_SES_INGEST_ENABLED: 'true', BUYFLOW_SES_INGEST_SECRET: 'too-short' }),
    { enabled: true, secret: null },
  );

  const secret = '12345678901234567890123456789012';
  assert.deepEqual(
    sesInboundRuntimeConfig({ BUYFLOW_SES_INGEST_ENABLED: 'TRUE', BUYFLOW_SES_INGEST_SECRET: secret }),
    { enabled: true, secret },
  );
});

test('SES shared secret comparison rejects missing and different values', () => {
  const secret = '12345678901234567890123456789012';
  assert.equal(verifySesInboundSecret(undefined, secret), false);
  assert.equal(verifySesInboundSecret('wrong', secret), false);
  assert.equal(verifySesInboundSecret(`${secret}x`, secret), false);
  assert.equal(verifySesInboundSecret(secret, secret), true);
});

test('SES bridge derives the BuyFlow recipient and security verdicts from SES metadata', () => {
  const payload = normalizeSesInboundBridgePayload({
    notification: notification(),
    bodyHtml: '<p>Tracking number: 12345678</p><p>Your parcel has been shipped.</p>',
    attachments: [
      { id: 'att-1', filename: 'invoice.pdf', contentType: 'application/pdf', size: 1234 },
    ],
  });

  const prepared = prepareSesInboundBridge(payload);
  assert.deepEqual(prepared.recipients, ['kozma0508@buyflow.hu']);
  assert.equal(prepared.email.provider, 'ses');
  assert.equal(prepared.email.providerMessageId, 'ses-message-123');
  assert.equal(prepared.email.from[0]?.email, 'noreply@gls-hungary.com');
  assert.equal(prepared.email.attachments[0]?.filename, 'invoice.pdf');
  assert.equal(prepared.security.disposition, 'accept');
  assert.equal(prepared.security.signals.dkim, 'PASS');
});

test('virus FAIL remains a hard reject before the BuyFlow pipeline', () => {
  const payload = normalizeSesInboundBridgePayload({
    notification: notification({
      receipt: {
        timestamp: '2026-08-18T18:10:01.000Z',
        recipients: ['kozma0508@buyflow.hu'],
        spamVerdict: { status: 'PASS' },
        virusVerdict: { status: 'FAIL' },
        spfVerdict: { status: 'PASS' },
        dkimVerdict: { status: 'PASS' },
        dmarcVerdict: { status: 'PASS' },
      },
    }),
  });

  const prepared = prepareSesInboundBridge(payload);
  assert.equal(prepared.security.disposition, 'reject');
  assert.equal(prepared.security.signals.virus, 'FAIL');
});

test('non-BuyFlow recipients are not routed into user mailboxes', () => {
  const payload = normalizeSesInboundBridgePayload({
    notification: notification({
      receipt: {
        timestamp: '2026-08-18T18:10:01.000Z',
        recipients: ['someone@example.com'],
        spamVerdict: { status: 'PASS' },
        virusVerdict: { status: 'PASS' },
        spfVerdict: { status: 'PASS' },
        dkimVerdict: { status: 'PASS' },
        dmarcVerdict: { status: 'PASS' },
      },
    }),
  });

  assert.deepEqual(prepareSesInboundBridge(payload).recipients, []);
});

test('bridge payload is bounded and exposes attachment metadata only', () => {
  const longHtml = `  ${'x'.repeat(300_000)}  `;
  const longSnippet = `  ${'y'.repeat(70_000)}  `;
  const payload = normalizeSesInboundBridgePayload({
    notification: notification(),
    bodyHtml: longHtml,
    snippet: longSnippet,
    attachments: [
      { id: 'att-1', filename: 'invoice.pdf', contentType: 'application/pdf', size: 42, extraSecret: 'ignored' },
    ],
  });

  assert.equal(payload.bodyHtml?.length, 250_000);
  assert.equal(payload.snippet?.length, 50_000);
  assert.deepEqual(payload.attachments, [
    { id: 'att-1', filename: 'invoice.pdf', contentType: 'application/pdf', size: 42 },
  ]);
});
