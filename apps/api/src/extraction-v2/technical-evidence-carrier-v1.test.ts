import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectCarrierTechnicalEvidenceV1 } from './technical-evidence-carrier-v1.js';

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'nylas' as EmailDocumentV1['provider'],
    providerMessageId: 'opaque-fixture',
    receivedAt: '2026-08-23T20:00:00.000Z',
    sender: {
      addresses: [],
      domains: ['example.test'],
      primaryEmail: null,
      primaryDomain: 'example.test',
      primaryName: null,
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: null,
    text: '',
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
    },
    ...overrides,
  };
}

function sender(domain: string): EmailDocumentV1['sender'] {
  return {
    addresses: [],
    domains: [domain],
    primaryEmail: null,
    primaryDomain: domain,
    primaryName: null,
  };
}

test('DPD semantic adapter keeps same exact parcel identity across shipped, out-for-delivery and delivered', () => {
  const tracking = '16380143870000';
  const cases = [
    {
      subject: `Értesítés ${tracking} Example Kft. küldemény feladásáról`,
      text: `Partnerünk az Ön részére kézbesítendő csomagot adott fel. ${tracking}`,
      event: 'shipment',
    },
    {
      subject: `Értesítés ${tracking} Example Kft. küldemény mai kézbesítéséről`,
      text: `Futárunk a mai napon kézbesítésre átvette. ${tracking}`,
      event: 'shipment',
    },
    {
      subject: `Értesítés ${tracking} sikeres kézbesítéséről`,
      text: `Értesítjük, hogy ${tracking} küldeményét a mai napon sikeresen kézbesítettük.`,
      event: 'delivery',
    },
  ];

  for (const item of cases) {
    const result = collectCarrierTechnicalEvidenceV1(fixture({
      sender: sender('dpd.hu'),
      subject: item.subject,
      text: item.text,
    }));

    assert.equal(result.productionWrites, 0);
    assert.equal(result.aiCalls, 0);
    assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
      && row.normalizedValue === tracking
      && row.namespace === 'DPD'));
    assert.ok(result.evidence.some((row) => row.kind === 'event'
      && row.normalizedValue === item.event));
  }
});

test('DPD adapter refuses lookalike sender and never treats opaque code query parameter as tracking', () => {
  const text = 'https://www.dpdgroup.com/hu/mydpd/fmp/pin?code=PCUBC2zXKiMmgPa';

  const wrongSender = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('example.test'),
    subject: 'Értesítés 16380143870000 sikeres kézbesítéséről',
    text: `16380143870000 küldeményét sikeresen kézbesítettük. ${text}`,
  }));
  assert.deepEqual(wrongSender.evidence, []);

  const realSenderOpaqueOnly = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('dpd.hu'),
    subject: 'Tájékoztatás',
    text,
  }));
  assert.ok(realSenderOpaqueOnly.evidence.some((row) => row.kind === 'carrier'));
  assert.ok(!realSenderOpaqueOnly.evidence.some((row) => row.kind === 'tracking_number'));
});

test('FOXPOST pre-advice yields identity without falsely claiming physical shipment', () => {
  const tracking = 'CLFOX178524111362000';
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('foxpost.hu'),
    subject: 'Előértesítés',
    text: `Csomagszám: ${tracking}\nA csomagot még nem adták át a FOXPOST részére.`,
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === tracking
    && row.namespace === 'FOXPOST'));
  assert.ok(!result.evidence.some((row) => row.kind === 'event'));
});

test('FOXPOST warehouse and ready-for-pickup keep exact FOXPOST identity; ready mail may also expose Packeta identity', () => {
  const tracking = 'CLFOX178524111362000';

  const warehouse = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('foxpost.hu'),
    subject: 'Csomagod már a raktárunkban van',
    text: `Csomagod, amelyet Example Shop adott fel, beérkezett raktárunkba.\nCsomagod azonosítószáma: ${tracking}`,
  }));
  assert.ok(warehouse.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === tracking
    && row.namespace === 'FOXPOST'));
  assert.ok(warehouse.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));

  const ready = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('foxpost.hu'),
    subject: 'Csomagod megérkezett',
    text: `Csomagod megérkezett, amely átvehető az alábbiak szerint:\nCsomagod Packeta azonosítószáma: Z3493891000\nCsomagod FOXPOST azonosítószáma: ${tracking}`,
  }));
  assert.ok(ready.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === tracking
    && row.namespace === 'FOXPOST'));
  assert.ok(ready.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === 'Z3493891000'
    && row.namespace === 'PACKETA'));
  assert.ok(ready.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));
});

test('FOXPOST adapter refuses CLFOX-looking identifier from unrelated sender', () => {
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('newsletter.example'),
    subject: 'Csomagod megérkezett',
    text: 'Csomagod FOXPOST azonosítószáma: CLFOX178524111362000',
  }));
  assert.deepEqual(result.evidence, []);
});

test('Packeta accepted-for-transport template yields shipment plus corroborated Z identifier', () => {
  const tracking = 'Z3493891717';
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('packeta.hu'),
    subject: 'A szállítmányt elfogadták a szállításra',
    text: [
      'Webáruház Example Shop átadta nekünk az Ön alábbi megrendelését Z 349 3891 717,',
      'melyet szerződéses szállítópartnerünk fog kézbesíteni.',
      'Részletekért keresse fel a tracking.packeta.com oldalt',
      'és adja meg csomagja Z-számát Z 349 3891 717,',
      'csomag nyomonkövetése Z 349 3891 717',
      'https://tracking.packeta.com?id=Z3493891717',
    ].join('\n'),
  }));

  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.ok(result.evidence.some((row) => row.kind === 'carrier'
    && row.normalizedValue === 'Packeta'
    && row.namespace === 'PACKETA'));
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === tracking
    && row.namespace === 'PACKETA'));
  assert.ok(result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));
});

test('Packeta legacy buyer shipment template yields event and hard Z-id only with endpoint corroboration', () => {
  const tracking = 'Z3394543991';
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('packeta.hu'),
    subject: 'A szállítmányt elfogadták a szállításra',
    text: [
      'Az Example Shop feladó most adta fel az Ön csomagját, amely Z-BOXba kerül kézbesítésre.',
      'Csomagszám Z 339 4543 991',
      'https://tracking.packeta.com/?id=Z3394543991',
    ].join('\n'),
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.normalizedValue === tracking
    && row.namespace === 'PACKETA'));
  assert.ok(result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));
});

test('Packeta hard identifier requires exact sender authority and corroborating Z-id primitives', () => {
  const body = [
    'adja meg csomagja Z-számát Z 349 3891 717',
    'csomag nyomonkövetése Z 349 3891 717',
    'https://tracking.packeta.com?id=Z3493891717',
  ].join('\n');

  const marketingSubdomain = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('hirek.packeta.hu'),
    subject: 'A szállítmányt elfogadták a szállításra',
    text: body,
  }));
  assert.deepEqual(marketingSubdomain.evidence, []);

  const unrelatedSender = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('example.test'),
    subject: 'A szállítmányt elfogadták a szállításra',
    text: body,
  }));
  assert.deepEqual(unrelatedSender.evidence, []);

  const onePrimitiveOnly = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('packeta.hu'),
    subject: 'Tájékoztatás',
    text: 'adja meg csomagja Z-számát Z 349 3891 717',
  }));
  assert.ok(onePrimitiveOnly.evidence.some((row) => row.kind === 'carrier'));
  assert.ok(!onePrimitiveOnly.evidence.some((row) => row.kind === 'tracking_number'));
  assert.ok(!onePrimitiveOnly.evidence.some((row) => row.kind === 'event'));
});

test('Packeta conflicting Z identifiers never produce a hard tracking identifier', () => {
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    sender: sender('packeta.hu'),
    subject: 'Tájékoztatás',
    text: [
      'Csomagszám Z 349 3891 717',
      'adja meg csomagja Z-számát Z 349 3891 717',
      'csomag nyomonkövetése Z 349 3891 718',
      'https://tracking.packeta.com?id=Z3493891719',
    ].join('\n'),
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'carrier'));
  assert.ok(!result.evidence.some((row) => row.kind === 'tracking_number'));
});
