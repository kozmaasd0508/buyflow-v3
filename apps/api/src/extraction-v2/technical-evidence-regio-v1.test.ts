import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectRegioTechnicalEvidenceV1 } from './technical-evidence-regio-v1.js';
import { collectTechnicalEvidenceV15 } from './technical-evidence-v1-5.js';

const REGIO_HEADERS = [
  { name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@regiojatek.hu; spf=pass; dmarc=pass header.from=regiojatek.hu' },
  { name: 'Content-Type', value: 'multipart/alternative; boundary="SiteEngine(c)GreyMatter-opaque-1"' },
];

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'opaque-regio-test',
    receivedAt: '2025-06-28T06:24:31.000Z',
    sender: {
      addresses: [{ email: 'ugyfelszolgalat@regiojatek.hu', name: 'REGIO JÁTÉK' }],
      domains: ['regiojatek.hu'],
      primaryEmail: 'ugyfelszolgalat@regiojatek.hu',
      primaryDomain: 'regiojatek.hu',
      primaryName: 'REGIO JÁTÉK',
    },
    recipients: { to: [{ email: 'user@example.test' }], cc: [], bcc: [] },
    subject: null,
    text: '',
    html: null,
    headers: REGIO_HEADERS,
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [], amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
    ...overrides,
  };
}

function orderBody(extra: string): string {
  return [
    extra,
    'Rendelésszám: WS 79480/2025 (a rendelés időpontja: 2025. június 28.)',
    'REGIO JÁTÉK WEBÁRUHÁZ',
  ].join('\n');
}

function assertLifecycle(document: EmailDocumentV1, expected: string): void {
  const result = collectRegioTechnicalEvidenceV1(document);
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'platform'
    && row.normalizedValue === 'SiteEngine(c)GreyMatter'));
  assert.ok(result.evidence.some((row) => row.kind === 'order_number'
    && row.normalizedValue === 'WS 79480/2025'
    && row.namespace === 'MERCHANT:regiojatek.hu'));
  assert.ok(result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === expected));

  const composite = collectTechnicalEvidenceV15({ document });
  assert.ok(composite.evidence.some((row) => row.kind === 'order_number'
    && row.namespace === 'MERCHANT:regiojatek.hu'));
  assert.ok(composite.evidence.some((row) => row.kind === 'event'
    && row.source === 'merchant_semantic'
    && row.normalizedValue === expected));
}

test('REGIO SiteEngine order-received message becomes merchant-scoped order_created evidence', () => {
  assertLifecycle(fixture({
    subject: 'WS 79480/2025 számú megrendelésedet megkaptuk!',
    text: orderBody('Jelen üzenetünkkel visszaigazoljuk, hogy megrendelésed megérkezett és azt rögzítettük.'),
  }), 'order_created');
});

test('REGIO SiteEngine processing message becomes order_processing, never shipment', () => {
  const document = fixture({
    subject: 'WS 79480/2025 számú megrendelés teljesítésének megkezdése',
    text: orderBody('Örömmel jelentjük, hogy a WS 79480/2025 számú megrendelésed feldolgozását megkezdtük, csomagod hamarosan elküldjük a Packeta csomagpontra.'),
  });
  assertLifecycle(document, 'order_processing');
  const result = collectRegioTechnicalEvidenceV1(document);
  assert.ok(!result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'));
});

test('REGIO SiteEngine explicit carrier handoff becomes shipment', () => {
  assertLifecycle(fixture({
    subject: 'WS 79480/2025 számú megrendelésedet átadtuk a szállítónak!',
    text: orderBody('Az általad rendelt termékeket átadtuk a futárszolgálatnak kiszállításra, így hamarosan kézhez kapod őket.'),
  }), 'shipment');
});

test('REGIO survey mail stays non-actionable even with same sender, SiteEngine and order number', () => {
  const result = collectRegioTechnicalEvidenceV1(fixture({
    subject: 'Kíváncsiak vagyunk a véleményedre!',
    text: orderBody('Köszönjük, hogy nálunk vásároltál! Segíts nekünk egy rövid kérdőív kitöltésével.'),
  }));
  assert.deepEqual(result.evidence, []);
});

test('REGIO R1 fails closed without authenticated transport or SiteEngine boundary', () => {
  const wrongAuth = collectRegioTechnicalEvidenceV1(fixture({
    subject: 'WS 79480/2025 számú megrendelésedet megkaptuk!',
    text: orderBody('Jelen üzenetünkkel visszaigazoljuk, hogy megrendelésed megérkezett és azt rögzítettük.'),
    headers: [
      { name: 'Authentication-Results', value: 'mx.google.com; dkim=fail header.i=@regiojatek.hu' },
      REGIO_HEADERS[1]!,
    ],
  }));
  assert.deepEqual(wrongAuth.evidence, []);

  const noPlatform = collectRegioTechnicalEvidenceV1(fixture({
    subject: 'WS 79480/2025 számú megrendelésedet megkaptuk!',
    text: orderBody('Jelen üzenetünkkel visszaigazoljuk, hogy megrendelésed megérkezett és azt rögzítettük.'),
    headers: [REGIO_HEADERS[0]!, { name: 'Content-Type', value: 'multipart/alternative; boundary="ordinary"' }],
  }));
  assert.deepEqual(noPlatform.evidence, []);
});

test('REGIO R1 refuses mismatched or ambiguous order identity', () => {
  const mismatch = collectRegioTechnicalEvidenceV1(fixture({
    subject: 'WS 79480/2025 számú megrendelésedet megkaptuk!',
    text: 'Jelen üzenetünkkel visszaigazoljuk, hogy megrendelésed megérkezett és azt rögzítettük.\nRendelésszám: WS 79481/2025',
  }));
  assert.deepEqual(mismatch.evidence, []);
});
