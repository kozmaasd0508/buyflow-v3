import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAboutYouCommerceEmail } from './aboutyou-commerce-adapter.js';

test('parses a real ABOUT YOU shipment pattern without AI', () => {
  const result = parseAboutYouCommerceEmail({
    senderDomains: ['aboutyou.hu'],
    subject: 'ABOUT YOU [HU] - Szállítási információk: ayhu-590-359816317',
    bodyText: 'Szállítás megerősítése\nA csomag úton van\nRendelésszám\nayhu-590-359816317',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.merchant, 'ABOUT YOU');
  assert.equal(result.extraction.order_number, 'ayhu-590-359816317');
});

test('keeps rich ABOUT YOU order confirmation on the existing AI path', () => {
  assert.equal(parseAboutYouCommerceEmail({
    senderDomains: ['aboutyou.hu'],
    subject: 'ABOUT YOU [HU] - Megrendelés visszaigazolása: ayhu-590-359816317',
    bodyText: 'Köszönjük a megrendelésed! Rendelésszám ayhu-590-359816317 Végösszeg 20.690 Ft.',
  }), null);
});

test('keeps ABOUT YOU processing sender on the existing path', () => {
  assert.equal(parseAboutYouCommerceEmail({
    senderDomains: ['aboutyou.com'],
    subject: 'Frissítés a megrendelésedről, a csomagod azonnal feldolgozásra kerül',
    bodyText: 'a(z) ayhu-590-359816317 rendelésedet éppen összeállítjuk a raktárunkban.',
  }), null);
});

test('rejects lookalike ABOUT YOU sender domains', () => {
  assert.equal(parseAboutYouCommerceEmail({
    senderDomains: ['aboutyou.hu.attacker.com'],
    subject: 'ABOUT YOU [HU] - Szállítási információk: ayhu-590-359816317',
    bodyText: 'Szállítás megerősítése\nA csomag úton van\nRendelésszám\nayhu-590-359816317',
  }), null);
});

test('requires explicit shipment subject and order identity', () => {
  assert.equal(parseAboutYouCommerceEmail({
    senderDomains: ['aboutyou.hu'],
    subject: 'A csomagod hamarosan megérkezik',
    bodyText: 'Szállítás megerősítése\nA csomag úton van',
  }), null);
});
