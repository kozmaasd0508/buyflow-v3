import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectTechnicalEvidenceV16 } from './technical-evidence-v1-6.js';

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'opaque-v16-test',
    receivedAt: '2026-08-24T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'noreply@packeta.hu' }],
      domains: ['packeta.hu'],
      primaryEmail: 'noreply@packeta.hu',
      primaryDomain: 'packeta.hu',
      primaryName: 'Packeta Hungary',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'A szállítmányt elfogadták a szállításra',
    text: 'Az regiojatek.hu feladó most adta fel az Ön csomagját.\nCsomagszám Z 339 4543 991',
    html: '<a href="https://tracking.packeta.com/?id=Z3394543991">Csomagkövetés</a>',
    headers: [{ name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@packeta.hu; dmarc=pass header.from=packeta.hu' }],
    attachments: [],
    sections: [],
    signals: { orderNumbers: [], amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [] },
    ...overrides,
  };
}

test('v1.6 keeps v1.5 shadow invariants and adds Packeta provider-scoped evidence', () => {
  const result = collectTechnicalEvidenceV16({ document: fixture() });
  assert.equal(result.collectorVersion, '1.6.0');
  assert.equal(result.mode, 'shadow');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.namespace === 'PACKETA'
    && row.normalizedValue === 'Z3394543991'));
  assert.ok(result.ranExtractors.some((run) => run.id === 'carrier-semantic-evidence-v1.6'));
});

test('v1.6 does not weaken v1.5 on unrelated authenticated-looking noise', () => {
  const result = collectTechnicalEvidenceV16({
    document: fixture({
      sender: {
        addresses: [{ email: 'news@example.test' }],
        domains: ['example.test'],
        primaryEmail: 'news@example.test',
        primaryDomain: 'example.test',
        primaryName: 'Newsletter',
      },
      subject: 'Your package deals this week',
      text: 'Tracking ID: 605855689091000013605231. Save now.',
      html: '<a href="https://example.test/?id=Z3394543991">Open</a>',
      headers: [{ name: 'Authentication-Results', value: 'mx; dkim=pass header.i=@example.test; dmarc=pass header.from=example.test' }],
    }),
  });

  assert.equal(result.evidence.some((row) => row.namespace === 'PACKETA' || row.namespace === 'EXPRESS_ONE'), false);
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
});
