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
