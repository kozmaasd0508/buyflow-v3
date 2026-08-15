import assert from 'node:assert/strict';
import test from 'node:test';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';

test('deterministic parser can see order evidence after the old 20k cutoff', () => {
  const orderId = '3fe09c80-8d79-11f1-b193-cf13a29b46f5';
  const filler = 'promotional-layout-padding '.repeat(1_100);
  const html = [
    '<p>Szia, megvásároltad 2 terméket DemoSeller eladótól.</p>',
    `<div>${filler}</div>`,
    '<p>Kulacs szett <a href="https://t.allegro.hu/ajanlat/kulacs-szett-12345678901">termék</a> 1 830,00 Ft</p>',
    '<p>Második termék <a href="https://t.allegro.hu/ajanlat/masodik-termek-12345678902">termék</a> 1 855,00 Ft</p>',
    '<p>Futár utánvét, DPD 1 990,00 Ft</p>',
    '<p>ÖSSZESEN 5 675,00 Ft</p>',
    '<p>Fizetési mód utánvét</p>',
    `<p>Megrendelés száma ${orderId}</p>`,
  ].join('');

  const oldBody = htmlToCompactText(html, 20_000);
  const longBody = htmlToCompactText(html, 80_000);

  assert.equal(oldBody.includes(orderId), false);
  assert.equal(longBody.includes(orderId), true);

  const oldParsed = parseDeterministicCommerceEmail({
    senderDomains: ['allegro.com'],
    subject: 'Megvásároltad: Kulacs szett + 1 egyéb termék DemoSeller eladótól.',
    bodyText: oldBody,
  });
  const longParsed = parseDeterministicCommerceEmail({
    senderDomains: ['allegro.com'],
    subject: 'Megvásároltad: Kulacs szett + 1 egyéb termék DemoSeller eladótól.',
    bodyText: longBody,
  });

  assert.equal(oldParsed, null);
  assert.ok(longParsed);
  assert.equal(longParsed.extraction.order_number, orderId);
  assert.equal(longParsed.extraction.total, 5675);
  assert.equal(longParsed.extraction.products.length, 2);
});
