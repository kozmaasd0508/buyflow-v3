import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { filterCommerceEmail, isPromotionalCommerceNoise } from './commerce-email-filter.js';

function email(overrides: Partial<NormalizedEmail>): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'm1',
    receivedAt: '2026-07-31T19:24:42.000Z',
    from: [{ email: 'hello@example.com' }],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
    ...overrides,
  };
}

test('excludes Goddess new-collection marketing even when subject mentions a future package', () => {
  const message = email({
    from: [{ email: 'store+85580841304@g.shopifyemail.com' }],
    subject: '🌴ÚJ KOLLEKCIÓ!🌴 - HÉTFŐN INDUL AZ UTOLSÓ CSOMAG A NYÁRI SZÜNET ELŐTT!📦',
    snippet: 'SHOP THE DROP ✨ új kollekció, nézd meg a legújabb szetteket',
    bodyHtml: '<p>SHOP THE DROP</p><p>ÚJ KOLLEKCIÓ</p><a href="https://goddessbyfranko.com/product">Monaco bézs szett</a>',
    folders: ['INBOX', 'CATEGORY_PROMOTIONS'],
  });

  assert.equal(isPromotionalCommerceNoise(message), true);
  const result = filterCommerceEmail(message);
  assert.equal(result.relevant, false);
  assert.deepEqual(result.reasons, ['excluded_promotional_or_repurchase_marketing']);
});

test('excludes Galaxy event and offer newsletter with product prices', () => {
  const message = email({
    from: [{ email: 'info@galaxy.hu' }],
    subject: '🔥 Exkluzív Galaxy élmény vár az ETELE Plazában!',
    snippet: 'Játssz értékes Samsung nyereményekért és fedezd fel az exkluzív ajánlatokat.',
    bodyHtml: '<p>Fedezd fel az új Galaxy modelleket.</p><p>Exkluzív ajánlatok és nyeremények várnak.</p><p>969 900 Ft</p>',
    folders: ['INBOX', 'CATEGORY_PROMOTIONS'],
  });

  assert.equal(isPromotionalCommerceNoise(message), true);
  assert.equal(filterCommerceEmail(message).relevant, false);
});

test('excludes Sport8 repurchase coupon even when it repeats the old cart with quantities and prices', () => {
  const message = email({
    from: [{ email: 'info@sport8.hu' }],
    subject: 'Legutóbbi vásárlásod pont egy hónapja volt nálunk. Most ajándék kuponnal kedveskedünk!',
    snippet: 'Pont egy hónapja vásároltál nálunk utoljára, most -5% kupont ajánlunk.',
    bodyHtml: '<p>A kosarad tartalma ez volt:</p><p>3 x Protein Pasta 1.290 Ft</p><p>Újra kosárba: RELOAD_ORDER_LINK</p>',
    folders: ['INBOX', 'CATEGORY_UPDATES'],
  });

  assert.equal(isPromotionalCommerceNoise(message), true);
  const result = filterCommerceEmail(message);
  assert.equal(result.relevant, false);
  assert.deepEqual(result.reasons, ['excluded_promotional_or_repurchase_marketing']);
});

test('does not exclude a real order confirmation just because it contains a coupon footer', () => {
  const message = email({
    from: [{ email: 'orders@shop.example' }],
    subject: 'Rendelés visszaigazolás - rendelés száma 12345678',
    snippet: 'Köszönjük a rendelésed. Rendelésszám: 12345678. Végösszeg: 12 990 Ft.',
    bodyHtml: '<p>Megrendelés visszaigazolás</p><p>Rendelésszám: 12345678</p><p>Végösszeg: 12 990 Ft</p><p>Következő vásárlásodra kuponnal kedveskedünk.</p>',
    folders: ['INBOX', 'CATEGORY_PROMOTIONS'],
  });

  assert.equal(isPromotionalCommerceNoise(message), false);
  const result = filterCommerceEmail(message);
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('commerce_keyword'));
});

test('does not exclude a real shipment with tracking identity and promotional footer', () => {
  const message = email({
    from: [{ email: 'notify@expressone.hu' }],
    subject: 'Csomag kézbesítés ma',
    snippet: 'Csomagszám: 605855685055000013605231. Kedvezményes ajánlatainkért látogass el oldalunkra.',
    bodyHtml: '<p>Csomagszám: 605855685055000013605231</p><p>Exkluzív ajánlat</p><p>Kedvezmény</p>',
    folders: ['INBOX'],
  });

  assert.equal(isPromotionalCommerceNoise(message), false);
  const result = filterCommerceEmail(message);
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('known_carrier_sender'));
});
