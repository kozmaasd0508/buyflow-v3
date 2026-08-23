import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectCarrierTechnicalEvidenceV16 } from './technical-evidence-carrier-v16.js';

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'opaque-v16-carrier-test',
    receivedAt: '2026-08-24T00:00:00.000Z',
    sender: {
      addresses: [{ email: 'store@example.test' }],
      domains: ['example.test'],
      primaryEmail: 'store@example.test',
      primaryDomain: 'example.test',
      primaryName: 'Example',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Neutral',
    text: '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [], amounts: [], shippingAmounts: [], codAmounts: [], products: [], couriers: [], paymentMethods: [], shippingMethods: [], trackingNumbers: [],
    },
    ...overrides,
  };
}

function auth(domain: string): Array<{ name: string; value: string }> {
  return [
    { name: 'Authentication-Results', value: `mx.google.com; dkim=pass header.i=@${domain}; dmarc=pass header.from=${domain}` },
  ];
}

test('Packeta authenticated accepted-for-transport template yields namespaced parcel and shipment evidence', () => {
  const result = collectCarrierTechnicalEvidenceV16(fixture({
    sender: {
      addresses: [{ email: 'noreply@packeta.hu' }],
      domains: ['packeta.hu'],
      primaryEmail: 'noreply@packeta.hu',
      primaryDomain: 'packeta.hu',
      primaryName: 'Packeta Hungary',
    },
    subject: 'A szállítmányt elfogadták a szállításra',
    text: 'Az regiojatek.hu feladó most adta fel az Ön csomagját.\nCsomagszám Z 339 4543 991\nMegrendelés száma 1476177',
    html: '<a href="https://tracking.packeta.com/?id=Z3394543991">Csomagkövetés</a>',
    headers: auth('packeta.hu'),
  }));

  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'carrier' && row.namespace === 'PACKETA'));
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === 'Z3394543991'
    && row.namespace === 'PACKETA'));
  assert.ok(result.evidence.some((row) => row.kind === 'event' && row.normalizedValue === 'shipment'));
  assert.equal(result.evidence.some((row) => row.kind === 'tracking_number' && row.normalizedValue === '1476177'), false);
});

test('Packeta generic id link, forged From, and account-like mail fail closed', () => {
  const genericUrl = collectCarrierTechnicalEvidenceV16(fixture({
    sender: {
      addresses: [{ email: 'noreply@packeta.hu' }], domains: ['packeta.hu'], primaryEmail: 'noreply@packeta.hu', primaryDomain: 'packeta.hu', primaryName: 'Packeta',
    },
    subject: 'Információ',
    text: 'Tekintse meg fiókját.',
    html: '<a href="https://example.test/?id=Z3394543991">Megnyitás</a>',
    headers: auth('packeta.hu'),
  }));
  assert.deepEqual(genericUrl.evidence, []);

  const forgedFrom = collectCarrierTechnicalEvidenceV16(fixture({
    sender: {
      addresses: [{ email: 'noreply@packeta.hu' }], domains: ['packeta.hu'], primaryEmail: 'noreply@packeta.hu', primaryDomain: 'packeta.hu', primaryName: 'Packeta',
    },
    subject: 'A szállítmányt elfogadták a szállításra',
    text: 'A feladó most adta fel az Ön csomagját. Csomagszám Z3394543991',
    headers: [{ name: 'Authentication-Results', value: 'mx; dkim=fail header.i=@packeta.hu; dmarc=fail header.from=packeta.hu' }],
  }));
  assert.deepEqual(forgedFrom.evidence, []);
});

test('Express One authenticated physical inbound namespaces the long waybill and emits shipment', () => {
  const result = collectCarrierTechnicalEvidenceV16(fixture({
    sender: {
      addresses: [{ email: 'ertesites@expressone.hu' }], domains: ['expressone.hu'], primaryEmail: 'ertesites@expressone.hu', primaryDomain: 'expressone.hu', primaryName: 'Express One Hungary',
    },
    subject: 'Express One értesítő 2025.06.30.',
    text: 'Az Ön részére kézbesítendő küldeményének feldolgozását megkezdtük a központi raktárunkban (fizikálisan érkeztettük).\nA küldeményt a következő küldeményszámon (fuvarlevélszámon) tartjuk nyilván:\n158272700611845113605231\nThe respective shipment was registered with the following air waybill: 158272700611845113605231',
    headers: auth('expressone.hu'),
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'carrier' && row.namespace === 'EXPRESS_ONE'));
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === '158272700611845113605231'
    && row.namespace === 'EXPRESS_ONE'));
  assert.ok(result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'
    && row.qualifiers.includes('expressone_physical_inbound_template')));
});

test('Express One out-for-delivery and delivered templates remain distinct by qualifier/event', () => {
  const baseSender = {
    addresses: [{ email: 'ertesites@expressone.hu' }], domains: ['expressone.hu'], primaryEmail: 'ertesites@expressone.hu', primaryDomain: 'expressone.hu', primaryName: 'Express One Hungary',
  };
  const out = collectCarrierTechnicalEvidenceV16(fixture({
    sender: baseSender,
    subject: 'Csomag kézbesítés ma – ETA és módosítás',
    text: 'Futárunk a mai napon kézbesítésre átvette, melyet a következő küldeményszámon (fuvarlevélszámon) tartunk nyilván: 605855689091000013605231',
    headers: auth('expressone.hu'),
  }));
  assert.ok(out.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'
    && row.qualifiers.includes('expressone_out_for_delivery_template')));

  const delivered = collectCarrierTechnicalEvidenceV16(fixture({
    sender: baseSender,
    subject: 'Küldemény kézbesítve – kérdőív',
    text: 'GymBeam s.r.o. által 605855689091000013605231 számon feladott küldemény 2026-08-18 10:32:00 időpontban átadásra került. The shipment sent from GymBeam s.r.o. with the shipment ID 605855689091000013605231 has been delivered.',
    headers: auth('expressone.hu'),
  }));
  assert.ok(delivered.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'delivery'
    && row.qualifiers.includes('expressone_delivered_template')));
});

test('Express One opaque h redirect, wrong host trackingNr and unauthenticated sender do not create parcel identity', () => {
  const sender = {
    addresses: [{ email: 'ertesites@expressone.hu' }], domains: ['expressone.hu'], primaryEmail: 'ertesites@expressone.hu', primaryDomain: 'expressone.hu', primaryName: 'Express One Hungary',
  };
  const opaque = collectCarrierTechnicalEvidenceV16(fixture({
    sender,
    subject: 'Értesítés',
    text: 'Csomagkövetés',
    html: '<a href="https://tracking.expressone.hu/?h=aqmQsxIR">Tracking</a><a href="https://example.test/?trackingNr=605855689091000013605231">other</a>',
    headers: auth('expressone.hu'),
  }));
  assert.deepEqual(opaque.evidence, []);

  const unauthenticated = collectCarrierTechnicalEvidenceV16(fixture({
    sender,
    subject: 'Küldemény kézbesítve – kérdőív',
    text: 'The shipment with the shipment ID 605855689091000013605231 has been delivered.',
    headers: [{ name: 'Authentication-Results', value: 'mx; dkim=fail header.i=@expressone.hu; dmarc=fail header.from=expressone.hu' }],
  }));
  assert.deepEqual(unauthenticated.evidence, []);
});
