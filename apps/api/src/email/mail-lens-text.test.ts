import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMailLensText as normalize } from './mail-lens-text.js';

test('visible class and attribute values containing hidden do not delete an order', () => {
  for (const attribute of ['class="not-hidden"', 'data-description="hidden"', 'title="hidden"']) {
    assert.match(normalize({ bodyHtml: `<div ${attribute}>ORDER-123</div>` }).semanticText, /ORDER-123/);
  }
});
test('nested hidden subtrees never leak old delivery evidence or links', () => {
  for (const attribute of ['hidden', 'hidden="false"', 'aria-hidden="true"', 'style="display: none !important"', 'style="color:red;visibility:hidden"', 'style="mso-hide:all"']) {
    const result = normalize({ bodyHtml: `<div ${attribute}><div>old</div>DELIVERED<a href="https://old.example/">old tracking</a></div><p>PROCESSING</p>` });
    assert.equal(result.semanticText, 'PROCESSING');
    assert.equal(result.normalization.hiddenHtmlRemoved, true);
  }
});
test('numeric and named entities decode as literal text, never as new HTML markup', () => {
  assert.equal(normalize({ bodyHtml: '<p>Order &lt;ABC&gt; &#x31;&#50;&#51; &amp; &#246;</p>' }).semanticText, 'Order <ABC> 123 & ö');
});
test('short and empty replies cannot inherit the previous delivery', () => {
  for (const prefix of ['', 'OK\n', 'Köszönöm!\r\n']) {
    const result = normalize({ bodyText: `${prefix}On Tuesday Example wrote:\r\nDELIVERED` });
    assert.equal(result.semanticText, prefix.trim());
    assert.equal(result.normalization.quotedHistoryDetected, true);
    assert.match(result.bodyText, /DELIVERED/);
  }
});
test('HTML quote-only content cannot fall back to the snippet or archived body', () => {
  const result = normalize({ bodyHtml: '<blockquote type="cite">DELIVERED</blockquote>', snippet: 'DELIVERED' });
  assert.equal(result.semanticText, '');
  assert.match(result.bodyText, /DELIVERED/);
});
test('HTML quote blocks preserve authored replies following the quote', () => {
  const result = normalize({ bodyHtml: '<p>Current</p><div class="gmail_quote"><div>DELIVERED</div><a href="https://old.example/">old</a></div><p>Not received</p>' });
  assert.doesNotMatch(result.semanticText, /DELIVERED|old.example/);
  assert.match(result.semanticText, /Current\s+Not received/);
});
test('placeholder plain part falls back to meaningful HTML without merging conflicting parts', () => {
  const result = normalize({ bodyText: 'Kérjük, tekintse meg a HTML-változatot.', bodyHtml: '<p>ORDER-123 PROCESSING</p>' });
  assert.equal(result.semanticText, 'ORDER-123 PROCESSING');
  assert.equal(result.normalization.providerPlaceholderIgnored, true);
  assert.equal(normalize({ bodyText: 'ORDER-NEW', bodyHtml: '<p>ORDER-OLD</p>' }).semanticText, 'ORDER-NEW');
});
test('inline markup cannot split identifiers; table cells remain separated and safe URLs survive', () => {
  const result = normalize({ bodyHtml: '<table><tr><td>Order</td><td>AB<b>C</b>123</td></tr></table><a href="https://shop.example/order?id=123&amp;x=1">Order link</a><a href="javascript:alert(1)">unsafe</a>' });
  assert.match(result.semanticText, /Order ABC123/);
  assert.match(result.semanticText, /https:\/\/shop.example\/order\?id=123&x=1/);
  assert.doesNotMatch(result.semanticText, /javascript:/);
});
test('authored truncation is explicit and quotes do not consume the semantic budget', () => {
  const result = normalize({ bodyHtml: `<blockquote>${'OLD'.repeat(100)}</blockquote><p>ORDER-123</p>` }, 12);
  assert.equal(result.semanticText, 'ORDER-123');
  assert.equal(result.normalization.bodyTextTruncated, true);
  assert.equal(result.normalization.semanticTextTruncated, false);
  assert.equal(normalize({ bodyText: 'ABCDEFGHIJ' }, 4).normalization.semanticTextTruncated, true);
});
test('plain interleaved replies preserve unquoted authored lines', () => {
  assert.equal(normalize({ bodyText: '> Delivered\nNot received\n> Signed\nNot by me' }).semanticText, 'Not received\nNot by me');
});


test('provider body outranks a shorter snippet and preserves late order tracking and payment evidence', () => {
  const body = [
    'Rendelését rögzítettük.',
    'Megrendelés azonosító: 98691-106839',
    'Csomagszám: CLFOX178971847766417',
    'Fizetett összeg: 140 000 HUF',
  ].join('\n');
  const result = normalize({
    snippet: 'Rendelését rögzítettük.',
    bodyText: body,
  });
  assert.equal(result.normalization.bodyTextSource, 'provider_plain');
  assert.equal(result.semanticText, body);
  assert.match(result.semanticText, /98691-106839/);
  assert.match(result.semanticText, /CLFOX178971847766417/);
  assert.match(result.semanticText, /140 000 HUF/);
});


test('compacts long redirect URLs but preserves short direct tracking URLs', () => {
  const redirect = 'https://mailer.example/tr/cl/' + 'x'.repeat(500);
  const tracking = 'https://tracking.packeta.com/hu/?id=Z2746595832';
  const result = normalize({ bodyText: `Order ready [open](${redirect}) Track: ${tracking}` });
  assert.ok(result.semanticText.length < redirect.length);
  assert.match(result.semanticText, /https:\/\/mailer\.example\/…/);
  assert.match(result.semanticText, /https:\/\/tracking\.packeta\.com\/hu\/\?id=Z2746595832/);
  assert.equal(result.normalization.semanticUrlsCompacted, 1);
});

test('preserves useful identifiers from long URLs while removing opaque query noise', () => {
  const url = 'https://shop.example/track?' + new URLSearchParams({
    id: 'TRACK-123',
    utm_source: 'x'.repeat(400),
    campaign: 'y'.repeat(400),
  }).toString();
  const result = normalize({ bodyText: `Track here: ${url}` });
  assert.match(result.semanticText, /https:\/\/shop\.example\/track\?id=TRACK-123/);
  assert.doesNotMatch(result.semanticText, /utm_source|campaign/);
});

test('trims a large standalone legal terms tail only after authored commerce evidence', () => {
  const body = [
    'Rendelésszám: ORD-123',
    'Nyomkövetési kód: TRACK-123',
    'Termék: Example',
    'x'.repeat(900),
    'ÁLTALÁNOS SZERZŐDÉSI FELTÉTELEK',
    'legal '.repeat(2000),
  ].join('\n');
  const result = normalize({ bodyText: body }, 20_000);
  assert.match(result.semanticText, /ORD-123/);
  assert.match(result.semanticText, /TRACK-123/);
  assert.doesNotMatch(result.semanticText, /legal legal/);
  assert.equal(result.normalization.legalBoilerplateTrimmed, true);
  assert.equal(result.normalization.semanticTextTruncated, false);
});

test('does not trim a terms document whose heading is near the start', () => {
  const body = 'ÁLTALÁNOS SZERZŐDÉSI FELTÉTELEK\n' + 'Legal update '.repeat(100);
  const result = normalize({ bodyText: body });
  assert.match(result.semanticText, /ÁLTALÁNOS SZERZŐDÉSI FELTÉTELEK/);
  assert.equal(result.normalization.legalBoilerplateTrimmed, false);
});
