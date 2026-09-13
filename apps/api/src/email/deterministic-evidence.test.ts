import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareDeterministicEvidence as prepare } from './deterministic-evidence.js';
import { parseDeterministicLifecycleEmail } from '../ingestion/deterministic-lifecycle-parser.js';
import { parseLimoneOrderEmail } from '../ingestion/limone-order-adapter.js';
import { parseNormalizedDeterministicEmail } from '../ingestion/normalized-email-deterministic.js';
import type { NormalizedEmail } from './types.js';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const base: NormalizedEmail = {
  provider: 'nylas', providerMessageId: 'synthetic', from: [], to: [], cc: [], bcc: [],
  receivedAt: '2026-09-13T00:00:00Z', folders: [], attachments: [],
};
const orderBody = 'Webáruházunkban rendelést adott le.\nAzonosító\n98691-106627\nEz egy automata visszaigazolás a megrendelés leadásáról.';
const orderSubject = 'Automata megrendelés visszaigazolás - 98691-106627';

test('hidden historic cancellation cannot become a new deterministic lifecycle event', () => {
  const email = { ...base, subject: 'A rendelés állapota megváltozott',
    bodyHtml: '<div style="display:none"><div>Previous</div>Rendelésszám: 535574 Jelenlegi állapot: Törölve</div><p>Rendelésszám: 535574. A befizetésed megérkezett.</p>' };
  const evidence = prepare(email);
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], ...evidence }), null);
  const realCancellation = prepare({ ...email, bodyHtml: '<p>Rendelésszám: 535574 Jelenlegi állapot: Törölve</p>' });
  assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], ...realCancellation })?.lifecycleEvent, 'cancelled');
});

test('quoted Limone confirmation cannot create a purchase, while a fresh confirmation still parses', () => {
  const email = { ...base, subject: `Re: ${orderSubject}`,
    bodyHtml: `<p>Köszönöm!</p><blockquote>${orderBody.replaceAll('\n', '<br>')}</blockquote>` };
  const legacyBody = htmlToCompactText(email.bodyHtml);
  const unsafe = parseLimoneOrderEmail({ senderDomains: ['limone.hu'], subject: email.subject, bodyText: legacyBody });
  assert.ok(unsafe);
  const oldValidation = validateEmailExtraction({ extraction: unsafe.extraction, senderDomains: ['limone.hu'], subject: email.subject, bodyText: legacyBody });
  assert.equal(oldValidation.eligible_for_purchase_creation, true);
  assert.notEqual(oldValidation.validation_status, 'review');
  assert.equal(parseLimoneOrderEmail({ senderDomains: ['limone.hu'], ...prepare(email) }), null);
  const fresh = prepare({ ...email, subject: orderSubject, bodyHtml: `<p>${orderBody.replaceAll('\n', '<br>')}</p>` });
  assert.equal(parseLimoneOrderEmail({ senderDomains: ['limone.hu'], ...fresh })?.extraction.order_number, '98691-106627');
});

test('new visible Limone product data and product URLs survive the HTML normalization boundary', () => {
  const html = `<p>${orderBody.replaceAll('\n', '<br>')}</p>
    <p><a href="https://www.limone.hu/spd/synthetic-product">Synthetic Parfüm</a> (SYN-1)<br>8 000 Ft<br>2 db<br>16 000 Ft</p>
    <p>Végösszeg<br>16 000 Ft</p>`;
  const result = parseLimoneOrderEmail({ senderDomains: ['limone.hu'], ...prepare({ ...base, subject: orderSubject, bodyHtml: html }) });
  assert.ok(result);
  assert.equal(result.extraction.products.length, 1);
  assert.equal(result.extraction.products[0]?.name, 'Synthetic Parfum');
  assert.equal(result.extraction.products[0]?.quantity, 2);
  assert.equal(result.extraction.products[0]?.product_url, 'https://www.limone.hu/spd/synthetic-product');
  assert.equal(result.extraction.total, 16000);
});

test('inherited reply subjects cannot supply an old lifecycle state', () => {
  for (const prefix of ['Re:', 'RE[2]:', 'Fwd:', 'Válasz:']) {
    const evidence = prepare({ ...base, subject: `${prefix} Sikertelen bankkártyás fizetés`, bodyText: 'Rendelésszám: 535574\nA befizetésed megérkezett.' });
    assert.equal(evidence.subject, null);
    assert.equal(parseDeterministicLifecycleEmail({ senderDomains: ['gyerekjatekbolt.com'], ...evidence }), null);
    assert.equal(evidence.normalization.inheritedSubjectIgnored, true);
  }
});

test('Hungarian and Outlook quote headers cannot reintroduce a previous order', () => {
  for (const boundary of ['2026. aug. 1., Demo <shop@example.com> ezt írta:', 'From: shop@example.com\nTo: buyer@example.com\nSubject: Confirmation']) {
    const evidence = prepare({ ...base, subject: orderSubject, bodyText: `OK\n${boundary}\n${orderBody}` });
    assert.equal(evidence.bodyText, 'OK');
    assert.equal(parseLimoneOrderEmail({ senderDomains: ['limone.hu'], ...evidence }), null);
  }
});

test('provider-neutral automatic parsing rejects empty or truncated current evidence', () => {
  const quoteOnly = { ...base, subject: 'Your parcel has been shipped', from: [{email:'noreply@gls-hungary.com'}], bodyHtml: '<blockquote>Tracking number: 12345678\nYour parcel has been shipped.</blockquote>' };
  assert.equal(prepare(quoteOnly).canParseAutomatically, false);
  assert.equal(parseNormalizedDeterministicEmail(quoteOnly), null);
  assert.equal(prepare({ ...base, bodyText: 'ABCDEFGHIJ' }, 4).canParseAutomatically, false);
  assert.equal(prepare({ ...base, bodyText: 'ABCDEFGHIJ' }, 10).canParseAutomatically, true);
});

test('document titles are not visible order or delivery evidence', () => {
  assert.equal(prepare({ ...base, bodyHtml: '<html><head><title>DELIVERED</title></head><body><p>PROCESSING</p></body></html>' }).bodyText, 'PROCESSING');
});
