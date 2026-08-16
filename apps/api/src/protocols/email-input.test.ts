import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { detectProtocolEvidence } from './detect.js';
import {
  extractDkimDomains,
  extractReturnPathDomains,
  extractTransportHosts,
  htmlToProtocolText,
  protocolDetectionInputFromEmail,
} from './email-input.js';
import { BESTBYTE_MERCHANT_TEST_V1 } from './profiles/bestbyte-merchant-test-v1.js';
import { EURONICS_MERCHANT_TEST_V1 } from './profiles/euronics-merchant-test-v1.js';

function baseEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'msg_test',
    receivedAt: '2026-08-16T20:00:00.000Z',
    from: [],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
    ...overrides,
  };
}

test('extracts only passing DKIM domains from Authentication-Results headers', () => {
  const headers = [
    {
      name: 'Authentication-Results',
      value: 'mx.google.com; dkim=pass header.i=@euronics.hu header.s=s1; dkim=fail header.i=@attacker.test; spf=pass smtp.mailfrom=bounce.example',
    },
    {
      name: 'ARC-Authentication-Results',
      value: 'i=1; mx.google.com; dkim=pass header.d=amazonses.com; dmarc=pass header.from=euronics.hu',
    },
  ];

  assert.deepEqual(extractDkimDomains(headers), ['euronics.hu', 'amazonses.com']);
});

test('extracts Return-Path domains and Received transport hosts without exposing addresses', () => {
  const headers = [
    { name: 'Return-Path', value: '<noreply@bestbyte.hu>' },
    {
      name: 'Received',
      value: 'from noreply.bestbyte.smtp.hu (noreply.bestbyte.smtp.hu. [91.83.123.93]) by mx.google.com with ESMTPS id test',
    },
    {
      name: 'Received',
      value: 'from internal.local (unknown [10.0.0.1]) by noreply.bestbyte.smtp.hu with ESMTPA id test',
    },
  ];

  assert.deepEqual(extractReturnPathDomains(headers), ['bestbyte.hu']);
  assert.deepEqual(extractTransportHosts(headers), [
    'noreply.bestbyte.smtp.hu',
    'internal.local',
  ]);
});

test('converts HTML into protocol-searchable text while stripping script/style content', () => {
  const text = htmlToProtocolText([
    '<style>.hidden { display:none }</style>',
    '<script>fake refund</script>',
    '<p>Rendelésed&nbsp;rögzítettük.</p>',
    '<div>Azonosító: &#49;&#50;&#51;&#52;</div>',
  ].join(''));

  assert.equal(text, 'Rendelésed rögzítettük.\nAzonosító: 1234');
});

test('maps a normalized Nylas message into detector input including auth evidence', () => {
  const input = protocolDetectionInputFromEmail(baseEmail({
    from: [{ email: 'ugyfelszolgalat@euronics.hu', name: 'Euronics' }],
    subject: 'A(z) 12345678 számú rendelésedet fogadtuk!',
    bodyHtml: [
      '<p>Rendelésed rögzítettük.</p>',
      '<p>Rendelésed feldolgozását megkezdtük.</p>',
      '<p>Rendelés azonosító: 12345678</p>',
    ].join(''),
    headers: [
      {
        name: 'Authentication-Results',
        value: 'mx.google.com; dkim=pass header.i=@euronics.hu header.s=s1; spf=pass smtp.mailfrom=bounce.mandrillapp.com',
      },
      { name: 'Return-Path', value: '<bounce@mandrillapp.com>' },
    ],
  }));

  assert.deepEqual(input.senderDomains, ['euronics.hu']);
  assert.deepEqual(input.dkimDomains, ['euronics.hu']);
  assert.deepEqual(input.returnPathDomains, ['mandrillapp.com']);

  const evidence = detectProtocolEvidence(input, [EURONICS_MERCHANT_TEST_V1]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '12345678');
});

test('BestByte direct invoice is detectable from Nylas-normalized headers without invented DKIM', () => {
  const input = protocolDetectionInputFromEmail(baseEmail({
    from: [{ email: 'noreply@bestbyte.hu', name: 'BestByte Kft.' }],
    subject: 'Elektronikus számla - TEST11739BKSE26',
    bodyHtml: [
      '<p>Értesítjük, hogy TEST11739BKSE26 bizonylatszámmal új elektronikus számla készült az Önök részére.</p>',
      '<p>Elektronikus számlájukat és a hozzá tartozó hash kód mellékletben csatolásra került.</p>',
    ].join(''),
    headers: [
      { name: 'Return-Path', value: '<noreply@bestbyte.hu>' },
      {
        name: 'Authentication-Results',
        value: 'mx.google.com; spf=pass smtp.mailfrom=noreply@bestbyte.hu; dmarc=pass header.from=bestbyte.hu',
      },
      {
        name: 'Received',
        value: 'from noreply.bestbyte.smtp.hu (noreply.bestbyte.smtp.hu. [91.83.123.93]) by mx.google.com with ESMTPS id test',
      },
    ],
    attachments: [
      {
        id: 'pdf',
        filename: 'TEST11739BKSE26.PDF',
        contentType: 'application/pdf',
      },
      {
        id: 'hash',
        filename: 'HASH_TEST11739BKSE26.TXT',
        contentType: 'application/octet-stream',
      },
    ],
  }));

  assert.deepEqual(input.dkimDomains, []);
  assert.deepEqual(input.returnPathDomains, ['bestbyte.hu']);
  assert.ok(input.transportHosts?.includes('noreply.bestbyte.smtp.hu'));

  const evidence = detectProtocolEvidence(input, [BESTBYTE_MERCHANT_TEST_V1]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'INVOICE');
  assert.equal(evidence[0]?.identifiers.invoice_id, 'TEST11739BKSE26');
  assert.equal(evidence[0]?.production_eligible, false);
});
