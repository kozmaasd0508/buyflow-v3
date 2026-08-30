import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmailDocumentV1 } from './normalize-document-v1.js';
import type { NormalizedEmail } from './types.js';

function baseEmail(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'provider-message-1',
    subject: 'Order confirmed',
    from: [{ email: 'orders@shop.example' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-30T20:00:00.000Z',
    folders: ['inbox'],
    attachments: [],
    ...overrides,
  };
}

test('normalizes HTML, JSON-LD, schema microdata, links and auth before extraction', () => {
  const email = baseEmail({
    bodyHtml: `
      <html><body>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Order","orderNumber":"A-123","url":"https://shop.example/orders/A-123"}
        </script>
        <div itemscope itemtype="https://schema.org/ParcelDelivery">Package</div>
        <a href="https://shop.example/orders/A-123?utm_source=mail" rel="noopener">View order</a>
        <a href="javascript:alert(1)">bad</a>
      </body></html>`,
    headers: [{
      name: 'Authentication-Results',
      value: 'mx.example; dkim=pass header.d=shop.example; spf=pass smtp.mailfrom=shop.example; dmarc=pass header.from=shop.example',
    }],
  });

  const document = normalizeEmailDocumentV1(email, { traceId: 'trace-1' });
  assert.equal(document.traceId, 'trace-1');
  assert.match(document.bodyText ?? '', /Package/);
  assert.equal(document.authentication.dkim, 'pass');
  assert.equal(document.authentication.spf, 'pass');
  assert.equal(document.authentication.dmarc, 'pass');
  assert.deepEqual(document.structuredData.map((record) => record.schemaType).sort(), ['Order', 'ParcelDelivery']);
  assert.ok(document.links.some((link) => link.href.includes('/orders/A-123')));
  assert.ok(document.links.every((link) => !link.href.startsWith('javascript:')));
});

test('prefers provider plain text and fails closed on conflicting auth verdicts', () => {
  const email = baseEmail({
    bodyText: 'FULL PROVIDER PLAIN TEXT https://shop.example/order/1',
    snippet: 'short snippet',
    bodyHtml: '<p>html fallback should not replace provider text</p>',
    headers: [
      { name: 'Authentication-Results', value: 'mx-a; dkim=pass header.d=shop.example' },
      { name: 'Authentication-Results', value: 'mx-b; dkim=fail header.d=shop.example' },
    ],
  });

  const document = normalizeEmailDocumentV1(email);
  assert.equal(document.bodyText, 'FULL PROVIDER PLAIN TEXT https://shop.example/order/1');
  assert.equal(document.authentication.dkim, 'unknown');
  assert.equal(document.authentication.spf, 'unknown');
  assert.equal(document.authentication.dmarc, 'unknown');
});

test('malformed or oversized structured data never becomes a parsed record', () => {
  const email = baseEmail({
    bodyHtml: '<script type="application/ld+json">{invalid}</script><p>Hello</p>',
  });
  const document = normalizeEmailDocumentV1(email);
  assert.deepEqual(document.structuredData, []);
});
