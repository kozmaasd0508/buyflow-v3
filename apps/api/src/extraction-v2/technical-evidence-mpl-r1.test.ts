import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectCarrierTechnicalEvidenceV1 } from './technical-evidence-carrier-v1.js';
import { applyTechnicalEvidenceDirectionGateV1 } from './technical-evidence-direction-gate-v1.js';
import { collectTechnicalEvidenceV15 } from './technical-evidence-v1-5.js';

function fixture(overrides: Partial<EmailDocumentV1> = {}): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'gmail' as EmailDocumentV1['provider'],
    providerMessageId: 'opaque-mpl-fixture',
    receivedAt: '2025-06-24T14:25:45.000Z',
    sender: {
      addresses: [{ email: 'kozponti.ertesites@posta.hu', name: 'Magyar Posta' }],
      domains: ['posta.hu'],
      primaryEmail: 'kozponti.ertesites@posta.hu',
      primaryDomain: 'posta.hu',
      primaryName: 'Magyar Posta',
    },
    recipients: { to: [{ email: 'user@example.test' }], cc: [], bcc: [] },
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

function bodyFor(tracking: string, lifecycle: string): string {
  return [
    lifecycle,
    `Küldeményazonosító: ${tracking}`,
    `https://www.posta.hu/ugyfelszolgalat/nyomkovetes?ids=${tracking}`,
    'Üdvözlettel, Magyar Posta Logisztika (MPL)',
  ].join('\n');
}

function assertMplBuyerEvidence(document: EmailDocumentV1, tracking: string): void {
  const carrier = collectCarrierTechnicalEvidenceV1(document);
  assert.equal(carrier.productionWrites, 0);
  assert.equal(carrier.aiCalls, 0);
  assert.ok(carrier.evidence.some((row) => row.kind === 'carrier'
    && row.namespace === 'MPL'));
  assert.ok(carrier.evidence.some((row) => row.kind === 'tracking_number'
    && row.namespace === 'MPL'
    && row.normalizedValue === tracking));
  assert.ok(carrier.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));

  const composite = collectTechnicalEvidenceV15({ document });
  assert.ok(composite.evidence.some((row) => row.kind === 'tracking_number'
    && row.namespace === 'MPL'
    && row.normalizedValue === tracking));
  assert.ok(composite.evidence.some((row) => row.kind === 'event'
    && row.source === 'carrier_semantic'
    && row.normalizedValue === 'shipment'));

  const gated = applyTechnicalEvidenceDirectionGateV1({
    document,
    technicalEvidence: composite,
  });
  assert.equal(gated.direction, 'buyer_inbound');
  assert.equal(gated.purchaseAuthorityEligible, true);
  assert.ok(gated.eligibleEvidence.some((row) => row.kind === 'tracking_number'
    && row.namespace === 'MPL'));
  assert.ok(gated.eligibleEvidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));
}

test('MPL pre-advice requires direct posta.hu plus labelled id and official tracking endpoint', () => {
  const tracking = 'PBPE127053557';
  const document = fixture({
    subject: 'Csomagküldemény',
    text: bodyFor(tracking, 'Értesítjük, hogy csomagküldeményt adtak fel Önnek.'),
  });
  assertMplBuyerEvidence(document, tracking);
});

test('MPL in-country recipient template is buyer-inbound shipment evidence', () => {
  const tracking = 'JJD149024482541000013350';
  const document = fixture({
    subject: 'Küldeménye megérkezett az országba',
    text: bodyFor(
      tracking,
      'Értesítjük, hogy nemzetközi csomagja megérkezett Magyarországra, amelyet a postai feldolgozást követően kézbesítünk Önnek.',
    ),
  });
  assertMplBuyerEvidence(document, tracking);
});

test('MPL courier-today template is buyer-inbound shipment evidence, never delivery', () => {
  const tracking = 'JJD149024482541000013351';
  const document = fixture({
    subject: 'Csomagja a kézbesítőnél van',
    text: bodyFor(
      tracking,
      'Értesítjük, hogy csomagját kézbesítőnk átvette, így azt a mai napon megkíséreljük a megadott címre kézbesíteni.',
    ),
  });
  assertMplBuyerEvidence(document, tracking);
  const result = collectCarrierTechnicalEvidenceV1(document);
  assert.ok(!result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'delivery'));
});

test('MPL post-office pickup template is shipment-family evidence, never delivered', () => {
  const tracking = 'JJD149024482541000013352';
  const document = fixture({
    subject: 'Csomagja érkezett',
    text: bodyFor(
      tracking,
      'Nemzetközi küldeménye érkezett. Értesítjük, hogy nemzetközi küldeménye átvehető az alábbi postán.',
    ),
  });
  assertMplBuyerEvidence(document, tracking);
  const result = collectCarrierTechnicalEvidenceV1(document);
  assert.ok(!result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'delivery'));
});

test('MPL hard identity fails closed on wrong sender, one primitive, and conflicting identifiers', () => {
  const tracking = 'PBPE127053557';
  const wrongSender = collectCarrierTechnicalEvidenceV1(fixture({
    sender: {
      addresses: [{ email: 'spoof@example.test' }],
      domains: ['example.test'],
      primaryEmail: 'spoof@example.test',
      primaryDomain: 'example.test',
      primaryName: null,
    },
    subject: 'Csomagküldemény',
    text: bodyFor(tracking, 'Értesítjük, hogy csomagküldeményt adtak fel Önnek.'),
  }));
  assert.deepEqual(wrongSender.evidence, []);

  const onePrimitive = collectCarrierTechnicalEvidenceV1(fixture({
    subject: 'Csomagküldemény',
    text: `Értesítjük, hogy csomagküldeményt adtak fel Önnek.\nKüldeményazonosító: ${tracking}`,
  }));
  assert.ok(onePrimitive.evidence.some((row) => row.kind === 'carrier'));
  assert.ok(!onePrimitive.evidence.some((row) => row.kind === 'tracking_number'));
  assert.ok(!onePrimitive.evidence.some((row) => row.kind === 'event'));

  const conflict = collectCarrierTechnicalEvidenceV1(fixture({
    subject: 'Csomagküldemény',
    text: [
      'Értesítjük, hogy csomagküldeményt adtak fel Önnek.',
      `Küldeményazonosító: ${tracking}`,
      'https://www.posta.hu/ugyfelszolgalat/nyomkovetes?ids=PBPE127053558',
    ].join('\n'),
  }));
  assert.ok(conflict.evidence.some((row) => row.kind === 'carrier'));
  assert.ok(!conflict.evidence.some((row) => row.kind === 'tracking_number'));
  assert.ok(!conflict.evidence.some((row) => row.kind === 'event'));
});

test('MPL feedback or survey mail never gains delivered authority in R1', () => {
  const tracking = 'PBPE127053557';
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    subject: 'Véleménye fontos számunkra!',
    text: bodyFor(
      tracking,
      `A ${tracking} küldemény kézbesítése sikeresen megtörtént. Kérjük, ossza meg véleményét szolgáltatásunkról.`,
    ),
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'carrier'));
  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.namespace === 'MPL'));
  assert.ok(!result.evidence.some((row) => row.kind === 'event'));
});

test('MPL accepts the previously supported official nyitooldal tracking endpoint as corroboration', () => {
  const tracking = 'PBPE127053559';
  const result = collectCarrierTechnicalEvidenceV1(fixture({
    subject: 'Csomagküldemény',
    text: [
      'Értesítjük, hogy csomagküldeményt adtak fel Önnek.',
      `Küldeményazonosító: ${tracking}`,
      `https://www.posta.hu/nyomkovetes/nyitooldal?ids=${tracking}`,
    ].join('\n'),
  }));

  assert.ok(result.evidence.some((row) => row.kind === 'tracking_number'
    && row.namespace === 'MPL'
    && row.normalizedValue === tracking));
  assert.ok(result.evidence.some((row) => row.kind === 'event'
    && row.normalizedValue === 'shipment'));
});
