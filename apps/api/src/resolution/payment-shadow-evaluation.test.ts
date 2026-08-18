import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePaymentShadow,
  paymentShadowPrivacyDiagnostic,
} from './payment-shadow-evaluation.js';
import type { PaymentShadowPurchaseIdentity } from './payment-shadow-resolution.js';

function purchase(overrides: Partial<PaymentShadowPurchaseIdentity> = {}): PaymentShadowPurchaseIdentity {
  return {
    purchaseId: 'purchase-pcx',
    userId: 'user-1',
    merchantDomain: 'pcx.hu',
    merchantName: 'PCX',
    orderNumber: '9098786',
    totalAmount: 5798,
    currency: 'HUF',
    orderedAt: '2026-01-31T12:40:00Z',
    ...overrides,
  };
}

function simplePayPcx(overrides: Record<string, unknown> = {}) {
  return {
    sourceEmailId: 'source-pcx-payment',
    userId: 'user-1',
    provider: 'simplepay' as const,
    providerAuthenticated: true,
    subject: 'SimplePay - Sikeres fizetés - https://www.pcx.hu',
    body: `Tisztelt Ügyfelünk!
Online rendelés adatai:
Kereskedő: https://www.pcx.hu
SimplePay tranzakció azonosító: 794593997
Külső hivatkozási szám: 9098786
Fizetett összeg: 5 798 HUF
Tájékoztatjuk, hogy jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.`,
    receivedAt: '2026-01-31T13:21:53Z',
    ...overrides,
  };
}

test('authenticated PCX SimplePay evidence becomes shadow-linkable to one exact existing purchase', () => {
  const result = evaluatePaymentShadow(simplePayPcx(), [purchase()]);
  assert.ok(result);
  assert.equal(result.resolution.decision, 'shadow_linkable');
  assert.equal(result.resolution.purchaseId, 'purchase-pcx');
  assert.equal(result.wouldWrite, false);
});

test('same money and time but wrong merchant cannot shadow-link', () => {
  const result = evaluatePaymentShadow(simplePayPcx(), [
    purchase({
      purchaseId: 'purchase-other',
      merchantDomain: 'other-shop.hu',
      merchantName: 'Other Shop',
    }),
  ]);
  assert.ok(result);
  assert.notEqual(result.resolution.decision, 'shadow_linkable');
  assert.equal(result.wouldWrite, false);
});

test('stored-card Billingo SimplePay evidence remains unmatched even against an exact accidental purchase match', () => {
  const result = evaluatePaymentShadow(simplePayPcx({
    subject: 'SimplePay - Sikeres fizetés - https://www.billingo.hu',
    body: `Tisztelt Ügyfelünk!
A(z) https://www.billingo.hu elfogadóhelyen korábban eltárolásra került bankkártyája sikeresen terhelésre került partnerünk kérésére.
Online rendelés adatai:
Kereskedő: https://www.billingo.hu
SimplePay tranzakció azonosító: 791548516
Külső hivatkozási szám: B959027
Fizetett összeg: 3 670 HUF
Tájékoztatjuk, hogy jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.`,
  }), [purchase({
    purchaseId: 'purchase-billingo',
    merchantDomain: 'billingo.hu',
    merchantName: 'Billingo',
    orderNumber: 'B959027',
    totalAmount: 3670,
  })]);

  assert.ok(result);
  assert.equal(result.evidence.context, 'recurring_or_subscription');
  assert.equal(result.resolution.decision, 'unmatched');
  assert.equal(result.resolution.purchaseId, null);
});

test('GLS SoftPos SimplePay evidence remains unmatched even if money and merchant-like name accidentally align', () => {
  const result = evaluatePaymentShadow(simplePayPcx({
    subject: 'SimplePay - Sikeres fizetés',
    body: `Tisztelt Vásárló!
Kereskedő: GLS General Logistics Systems Hungary Kft.
Fizetés típusa: Érintéses fizetés SoftPos
SimplePay tranzakció azonosító: 850827149
Fizetett összeg: 8 745 HUF
Tájékoztatjuk, hogy jelen üzenet automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.`,
  }), [purchase({
    purchaseId: 'purchase-gls-like',
    merchantDomain: null,
    merchantName: 'GLS General Logistics Systems Hungary Kft.',
    totalAmount: 8745,
  })]);

  assert.ok(result);
  assert.equal(result.evidence.context, 'service_or_billing');
  assert.equal(result.resolution.decision, 'unmatched');
});

test('Barion merchant without an existing purchase stays unmatched', () => {
  const result = evaluatePaymentShadow({
    sourceEmailId: 'source-netfone',
    userId: 'user-1',
    provider: 'barion',
    providerAuthenticated: true,
    subject: 'Sikeres fizetés',
    body: `Sikeresen fizettél 26 234 Ft-ot bankkártyával!
Email: ugyfelszolgalat@netfone.hu
Elfogadóhely neve:
Netfone Telecom
Fizetés Barion azonosítója:
1bd9459c3a90f1119d1db8ca3a6352a2
Rendelés elfogadóhelyen nyilvántartott azonosítója:
Nincs megadva`,
    receivedAt: '2026-08-04T19:28:48Z',
  }, []);

  assert.ok(result);
  assert.equal(result.resolution.decision, 'unmatched');
  assert.equal(result.resolution.purchaseId, null);
});

test('two exact PCX purchases remain review and are explicitly marked ambiguous', () => {
  const result = evaluatePaymentShadow(simplePayPcx(), [
    purchase({ purchaseId: 'purchase-a' }),
    purchase({ purchaseId: 'purchase-b', orderedAt: '2026-01-31T13:00:00Z' }),
  ]);

  assert.ok(result);
  assert.equal(result.resolution.decision, 'review');
  const diagnostic = paymentShadowPrivacyDiagnostic(result);
  assert.equal(diagnostic.ambiguous, true);
  assert.equal(diagnostic.wouldWrite, false);
});

test('untrusted provider email cannot enter payment shadow evaluation', () => {
  const result = evaluatePaymentShadow(simplePayPcx({ providerAuthenticated: false }), [purchase()]);
  assert.equal(result, null);
});

test('privacy diagnostic contains only coarse flags and no raw identifiers', () => {
  const result = evaluatePaymentShadow(simplePayPcx(), [purchase()]);
  assert.ok(result);

  const diagnostic = paymentShadowPrivacyDiagnostic(result);
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'ambiguous',
    'context',
    'decision',
    'hasAmountCurrency',
    'hasMerchantDomainHint',
    'hasMerchantNameHint',
    'hasMerchantReference',
    'provider',
    'scoreBand',
    'strictSignalCount',
    'wouldWrite',
  ].sort());

  const serialized = JSON.stringify(diagnostic);
  assert.ok(!serialized.includes('794593997'));
  assert.ok(!serialized.includes('9098786'));
  assert.ok(!serialized.includes('pcx.hu'));
  assert.ok(!serialized.includes('purchase-pcx'));
  assert.equal(diagnostic.wouldWrite, false);
});
