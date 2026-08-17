import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAuthenticatedPaymentProviderEmail } from './payment-provider-shadow-normalizer.js';

function base(overrides: Record<string, unknown> = {}) {
  return {
    sourceEmailId: 'source-1',
    userId: 'user-1',
    provider: 'simplepay' as const,
    providerAuthenticated: true,
    subject: 'SimplePay - Sikeres fizetés - https://www.pcx.hu',
    body: `Tisztelt Ügyfelünk!
Online rendelés adatai:
Tranzakció dátuma: 2026.01.31. 14:21
Kereskedő: https://www.pcx.hu
SimplePay tranzakció azonosító: 794593997
Külső hivatkozási szám: 9098786
Fizetett összeg: 5 798 HUF
Tájékoztatjuk, hogy jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.`,
    receivedAt: '2026-01-31T13:21:53Z',
    ...overrides,
  };
}

test('real PCX-style SimplePay online purchase yields merchant domain, money and separated references', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base());

  assert.ok(result);
  assert.equal(result.provider, 'simplepay');
  assert.equal(result.merchantDomainHint, 'pcx.hu');
  assert.equal(result.merchantNameHint, null);
  assert.equal(result.amount, 5798);
  assert.equal(result.currency, 'HUF');
  assert.equal(result.paymentReference, '794593997');
  assert.equal(result.merchantReference, '9098786');
  assert.equal(result.context, 'purchase');
  assert.equal(result.confidence, 1);
});

test('real Billingo-style stored-card SimplePay charge is recurring context despite online-order label', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    subject: 'SimplePay - Sikeres fizetés - https://www.billingo.hu',
    body: `Tisztelt Ügyfelünk!
Ezúton tájékoztatjuk, hogy a(z) https://www.billingo.hu elfogadóhelyen korábban eltárolásra került bankkártyája sikeresen terhelésre került partnerünk kérésére.
Online rendelés adatai:
Kereskedő: https://www.billingo.hu
SimplePay tranzakció azonosító: 791548516
Külső hivatkozási szám: B959027
Fizetett összeg: 3 670 HUF
Tájékoztatjuk, hogy jelen üzenet a SimplePay rendszere által automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.`,
  }));

  assert.ok(result);
  assert.equal(result.merchantDomainHint, 'billingo.hu');
  assert.equal(result.context, 'recurring_or_subscription');
  assert.equal(result.amount, 3670);
});

test('real GLS SoftPos-style SimplePay receipt is service or billing context, not purchase context', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    subject: 'SimplePay - Sikeres fizetés',
    body: `Tisztelt Vásárló!
Ezúton tájékoztatjuk, hogy a(z) (GLS Hungary Kft.) elfogadóhelyet üzemeltető kereskedőnél végrehajtott vásárlását az alábbi tranzakcióval sikeresen kifizette.
Kereskedő: GLS General Logistics Systems Hungary Kft.
Tranzakció típusa: Eladás
Fizetés típusa: Érintéses fizetés SoftPos
SimplePay tranzakció azonosító: 850827149
Fizetett összeg: 8745 HUF
Tájékoztatjuk, hogy jelen üzenet automatikusan generált e-mail, mely a sikeres fizetés megtörténését igazolja.`,
  }));

  assert.ok(result);
  assert.equal(result.merchantNameHint, 'GLS General Logistics Systems Hungary Kft.');
  assert.equal(result.merchantDomainHint, null);
  assert.equal(result.context, 'service_or_billing');
});

test('real Barion-style success yields merchant contact domain and keeps missing merchant order reference null', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    provider: 'barion',
    subject: 'Sikeres fizetés',
    body: `Hello!
Sikeresen fizettél 26 234 Ft-ot bankkártyával!
Email: ugyfelszolgalat@netfone.hu
A tranzakció részletei:
Elfogadóhely neve:
Netfone Telecom
Fizetés Barion azonosítója:
1bd9459c3a90f1119d1db8ca3a6352a2
Rendelés elfogadóhelyen nyilvántartott azonosítója:
Nincs megadva
- Barion Team`,
    receivedAt: '2026-08-04T19:28:48Z',
  }));

  assert.ok(result);
  assert.equal(result.provider, 'barion');
  assert.equal(result.merchantDomainHint, 'netfone.hu');
  assert.equal(result.merchantNameHint, 'Netfone Telecom');
  assert.equal(result.amount, 26234);
  assert.equal(result.currency, 'HUF');
  assert.equal(result.paymentReference, '1bd9459c3a90f1119d1db8ca3a6352a2');
  assert.equal(result.merchantReference, null);
  assert.equal(result.context, 'unknown');
});

test('Barion merchant reference stays separate from provider payment reference', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    provider: 'barion',
    subject: 'Sikeres fizetés',
    body: `Sikeresen fizettél 12 500 Ft-ot bankkártyával!
Email: shop@example.hu
Elfogadóhely neve:
Example Shop
Fizetés Barion azonosítója:
PAYMENT-ABC-123
Rendelés elfogadóhelyen nyilvántartott azonosítója:
ORDER-7788`,
  }));

  assert.ok(result);
  assert.equal(result.paymentReference, 'PAYMENT-ABC-123');
  assert.equal(result.merchantReference, 'ORDER-7788');
  assert.equal(result.merchantDomainHint, 'example.hu');
});

test('provider normalization fails closed when authentication was not independently established', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({ providerAuthenticated: false }));
  assert.equal(result, null);
});

test('SimplePay success subject without provider transaction identity is insufficient', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    body: 'Fizetett összeg: 5 798 HUF\nA fizetés sikeres volt.',
  }));
  assert.equal(result, null);
});

test('Barion success subject without explicit successful payment sentence is insufficient', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    provider: 'barion',
    subject: 'Sikeres fizetés',
    body: `Fizetés Barion azonosítója:\nABC123\nElfogadóhely neve:\nExample Shop\n5 000 Ft`,
  }));
  assert.equal(result, null);
});

test('ambiguous dotted HUF amount is rejected instead of guessed as thousands or decimal', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    body: `Online rendelés adatai:
Kereskedő: https://www.pcx.hu
SimplePay tranzakció azonosító: 123456
Fizetett összeg: 5.798 HUF
Tájékoztatjuk, hogy a sikeres fizetés megtörténését igazolja.`,
  }));
  assert.equal(result, null);
});

test('Barion provider/footer domain never becomes merchant domain when merchant contact is absent', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    provider: 'barion',
    subject: 'Sikeres fizetés',
    body: `Sikeresen fizettél 5 000 Ft-ot bankkártyával!
Elfogadóhely neve:
Example Shop
Fizetés Barion azonosítója:
ABC123
Rendelés elfogadóhelyen nyilvántartott azonosítója:
Nincs megadva
https://secure.barion.com/`,
  }));

  assert.ok(result);
  assert.equal(result.merchantDomainHint, null);
});

test('SimplePay malformed merchant URL is held without inventing a domain', () => {
  const result = normalizeAuthenticatedPaymentProviderEmail(base({
    body: `Online rendelés adatai:
Kereskedő: https://not a valid host
SimplePay tranzakció azonosító: 123456
Külső hivatkozási szám: X-1
Fizetett összeg: 5 798 HUF
Tájékoztatjuk, hogy a sikeres fizetés megtörténését igazolja.`,
  }));

  assert.ok(result);
  assert.equal(result.merchantDomainHint, null);
  assert.equal(result.merchantNameHint, 'https://not a valid host');
});
