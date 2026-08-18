import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySesSecurity,
  extractBuyFlowRecipients,
  normalizeSesInboundMetadata,
  toNormalizedSesEmail,
  type SesInboundNotificationLike,
  type SesSecuritySignals,
} from './ses-inbound.js';

function notification(overrides: Partial<SesInboundNotificationLike> = {}): SesInboundNotificationLike {
  return {
    mail: {
      timestamp: '2026-08-18T17:30:00.000Z',
      messageId: 'ses-message-123',
      destination: ['A7K92@buyflow.hu'],
      commonHeaders: {
        from: ['"Alza.hu" <info@alza.hu>'],
        to: ['A7K92@buyflow.hu'],
        subject: 'Megrendelés visszaigazolása',
      },
      headers: [
        { name: 'Authentication-Results', value: 'spf=pass; dkim=pass; dmarc=pass' },
      ],
    },
    receipt: {
      timestamp: '2026-08-18T17:30:01.000Z',
      recipients: ['A7K92@buyflow.hu'],
      spamVerdict: { status: 'PASS' },
      virusVerdict: { status: 'PASS' },
      spfVerdict: { status: 'PASS' },
      dkimVerdict: { status: 'PASS' },
      dmarcVerdict: { status: 'PASS' },
    },
    ...overrides,
  };
}

test('normalizes an SES receipt into transport-safe BuyFlow metadata', () => {
  const metadata = normalizeSesInboundMetadata(notification());

  assert.equal(metadata.providerMessageId, 'ses-message-123');
  assert.equal(metadata.receivedAt, '2026-08-18T17:30:01.000Z');
  assert.deepEqual(metadata.buyflowRecipients, ['a7k92@buyflow.hu']);
  assert.equal(metadata.subject, 'Megrendelés visszaigazolása');
  assert.deepEqual(metadata.from, [{ email: 'info@alza.hu', name: 'Alza.hu' }]);
  assert.equal(metadata.disposition, 'accept');
  assert.deepEqual(metadata.security, {
    spam: 'PASS',
    virus: 'PASS',
    spf: 'PASS',
    dkim: 'PASS',
    dmarc: 'PASS',
  });
});

test('creates the same NormalizedEmail shape used by the existing BuyFlow engine', () => {
  const metadata = normalizeSesInboundMetadata(notification());
  const email = toNormalizedSesEmail({
    metadata,
    bodyHtml: '<p>Rendelésszám: 123456</p>',
  });

  assert.equal(email.provider, 'ses');
  assert.equal(email.providerMessageId, 'ses-message-123');
  assert.equal(email.from[0]?.email, 'info@alza.hu');
  assert.equal(email.to[0]?.email, 'a7k92@buyflow.hu');
  assert.equal(email.bodyHtml, '<p>Rendelésszám: 123456</p>');
  assert.deepEqual(email.folders, ['inbound']);
});

test('filters and deduplicates only the configured BuyFlow recipient domain', () => {
  assert.deepEqual(
    extractBuyFlowRecipients([
      'A7K92@BUYFLOW.HU',
      'a7k92@buyflow.hu',
      'other@example.com',
      'b8m31@buyflow.hu',
    ]),
    ['a7k92@buyflow.hu', 'b8m31@buyflow.hu'],
  );
});

test('quarantines spam instead of silently deleting it', () => {
  const metadata = normalizeSesInboundMetadata(notification({
    receipt: {
      timestamp: '2026-08-18T17:30:01.000Z',
      recipients: ['a7k92@buyflow.hu'],
      spamVerdict: { status: 'FAIL' },
      virusVerdict: { status: 'PASS' },
      spfVerdict: { status: 'PASS' },
      dkimVerdict: { status: 'PASS' },
      dmarcVerdict: { status: 'PASS' },
    },
  }));

  assert.equal(metadata.disposition, 'quarantine');
  assert.deepEqual(metadata.buyflowRecipients, ['a7k92@buyflow.hu']);
});

test('rejects a confirmed virus verdict', () => {
  const signals: SesSecuritySignals = {
    spam: 'PASS',
    virus: 'FAIL',
    spf: 'PASS',
    dkim: 'PASS',
    dmarc: 'PASS',
  };

  assert.equal(classifySesSecurity(signals), 'reject');
});

test('authentication failure remains evidence and does not destroy the email', () => {
  const signals: SesSecuritySignals = {
    spam: 'PASS',
    virus: 'PASS',
    spf: 'FAIL',
    dkim: 'FAIL',
    dmarc: 'FAIL',
  };

  assert.equal(classifySesSecurity(signals), 'accept');
});

test('fails closed on malformed SES notifications without a message id', () => {
  assert.throws(
    () => normalizeSesInboundMetadata({
      mail: { timestamp: '2026-08-18T17:30:00.000Z' },
      receipt: { timestamp: '2026-08-18T17:30:01.000Z' },
    }),
    /missing mail\.messageId/,
  );
});
