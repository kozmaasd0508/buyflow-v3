import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractUniversalOrderIdentityV2,
  normalizeUniversalOrderIdentifierV2,
} from './universal-order-identity-v2.js';

function first(text: string): string | null {
  return extractUniversalOrderIdentityV2(text)[0]?.value ?? null;
}

test('recognizes Hungarian identifier-before-order inflections', () => {
  assert.equal(first('#1000579244 számú rendeléshez tartozó számla'), '1000579244');
  assert.equal(first('A #44609 számú rendelést megkaptuk.'), '44609');
  assert.equal(first('Számla a 90458062 számú megrendeléshez.'), '90458062');
});

test('recognizes order noun before hash or strong bare identifier', () => {
  assert.equal(first('Rendelésed #63937 szállításra kész.'), '63937');
  assert.equal(first('Új megrendelés 90458062 - elfogadva'), '90458062');
  assert.equal(first('Order #AB-9918274 confirmed'), 'AB-9918274');
});

test('recognizes explicit order identity labels across common languages', () => {
  assert.equal(first('Megrendelés azonosítója: 85701-284761'), '85701-284761');
  assert.equal(first('Order number: AB-9918274'), 'AB-9918274');
  assert.equal(first('Bestellung Nr.: DE-778812'), 'DE-778812');
  assert.equal(first('Commande numéro: FR-778812'), 'FR-778812');
  assert.equal(first('Pedido numero: ES-778812'), 'ES-778812');
});

test('does not reinterpret invoice or account numbers as order identity', () => {
  assert.equal(first('Számlaszám: 8021932478'), null);
  assert.equal(first('Ügyfélazonosító: 690000194345'), null);
  assert.equal(first('SimplePay tranzakció azonosító: 1234567890'), null);
});

test('bare short year/date-like values are not treated as order ids', () => {
  assert.equal(first('Rendelés 2025'), null);
  assert.equal(first('Rendelés 2025-11-10'), null);
});

test('identifier normalization rejects URLs and date-like values', () => {
  assert.equal(normalizeUniversalOrderIdentifierV2('https://shop.example/order/12345'), null);
  assert.equal(normalizeUniversalOrderIdentifierV2('2025-11-10'), null);
  assert.equal(normalizeUniversalOrderIdentifierV2('#AB-778812'), 'AB-778812');
});
