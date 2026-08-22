import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceProduct } from './types.js';
import { universalProductExtractor } from './product-extractor.js';
import { collectUniversalCoreEvidence } from './universal-core.js';

function email(snippet: string): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `test-${Math.random()}`,
    subject: 'Rendelési visszaigazolás',
    from: [{ email: 'orders@example-shop.hu', name: 'Example Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T20:00:00.000Z',
    snippet,
    folders: ['inbox'],
    attachments: [],
  };
}

function products(snippet: string): EvidenceProduct[] {
  return universalProductExtractor
    .extract(buildEmailDocumentV1(email(snippet)))
    .filter((claim) => claim.field === 'product')
    .map((claim) => claim.value as EvidenceProduct);
}

test('product extractor preserves quantity-prefixed product rows', () => {
  const result = products('2 x Hidrolizált Kollagén Italpor Hialuronsavval MANGO ízben');
  assert.ok(result.some((product) => product.name === 'Hidrolizált Kollagén Italpor Hialuronsavval MANGO ízben' && product.quantity === 2));
});

test('product extractor reads explicit product blocks with labeled quantity and prices', () => {
  const result = products([
    'Termék: Lattafa Khamrah 100 ml',
    'Mennyiség: 2',
    'Egységár: 12 990 Ft',
    'Termék összesen: 25 980 Ft',
  ].join('\n'));
  const product = result.find((candidate) => candidate.name === 'Lattafa Khamrah 100 ml');
  assert.ok(product);
  assert.equal(product.quantity, 2);
  assert.equal(product.unitPrice, 12990);
  assert.equal(product.totalPrice, 25980);
  assert.equal(product.currency, 'HUF');
});

test('product extractor reads structured table rows with quantity, unit price and line total', () => {
  const result = products('Lattafa Khamrah 100 ml | 2 db | 12 990 Ft | 25 980 Ft');
  const product = result.find((candidate) => candidate.name === 'Lattafa Khamrah 100 ml');
  assert.ok(product);
  assert.equal(product.quantity, 2);
  assert.equal(product.unitPrice, 12990);
  assert.equal(product.totalPrice, 25980);
  assert.equal(product.currency, 'HUF');
});

test('product extractor does not guess price semantics from one unlabeled table price', () => {
  const result = products('Lattafa Khamrah 100 ml | 2 db | 25 980 Ft');
  const product = result.find((candidate) => candidate.name === 'Lattafa Khamrah 100 ml');
  assert.ok(product);
  assert.equal(product.quantity, 2);
  assert.equal(product.unitPrice, null);
  assert.equal(product.totalPrice, null);
  assert.equal(product.currency, 'HUF');
});

test('product extractor strips trailing money without treating it as a guessed product price', () => {
  const result = products('1 x Lattafa Khamrah 100 ml 19 990 Ft');
  const product = result.find((candidate) => candidate.name === 'Lattafa Khamrah 100 ml');
  assert.ok(product);
  assert.equal(product.quantity, 1);
  assert.equal(product.unitPrice, null);
  assert.equal(product.totalPrice, null);
  assert.equal(product.currency, 'HUF');
});

test('product extractor rejects shipping, payment and discount rows', () => {
  const result = products([
    '1 x Szállítás 1 490 Ft',
    '1 x Fizetés kezelési díj 290 Ft',
    '1 x Kedvezmény 2 000 Ft',
  ].join('\n'));
  assert.equal(result.length, 0);
});

test('product extractor preserves multiple distinct products', () => {
  const result = products([
    '1 x Lattafa Khamrah 100 ml',
    '2 x Armaf Club de Nuit Intense Man 105 ml',
  ].join('\n'));
  assert.ok(result.some((product) => product.name === 'Lattafa Khamrah 100 ml' && product.quantity === 1));
  assert.ok(result.some((product) => product.name === 'Armaf Club de Nuit Intense Man 105 ml' && product.quantity === 2));
});

test('universal collector now runs seven non-short-circuit evidence extractors', () => {
  const result = collectUniversalCoreEvidence(buildEmailDocumentV1(email([
    'Rendelésszám: AB-12345',
    'Eladó: Example Shop',
    'Sikeres fizetés',
    'Végösszeg: 19 990 Ft',
    'Tracking number: 123456789012',
    'Invoice number: INV-2026-1234',
    '1 x Lattafa Khamrah 100 ml',
  ].join('\n'))));
  assert.equal(result.ranExtractors.length, 7);
  assert.ok(result.bundle.claims.some((claim) => claim.field === 'product'));
});
