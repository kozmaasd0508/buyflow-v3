import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmailWithOpenAI, htmlToCompactText } from './openai-email-extractor.js';

test('compacts email HTML without scripts and styles', () => {
  const result = htmlToCompactText('<style>x{}</style><p>Hello&nbsp;<b>world</b></p><script>bad()</script>');
  assert.equal(result, 'Hello world');
});

test('requests strict structured output with store disabled', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  event_type: 'shipment',
                  merchant: null,
                  order_number: null,
                  tracking_number: 'ABC123',
                  carrier: 'Example Carrier',
                  invoice_number: null,
                  total: null,
                  currency: null,
                  confidence: 0.97,
                }),
              },
            ],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await extractEmailWithOpenAI({
    apiKey: 'test-key',
    bodyText: 'Your parcel is on the way. Tracking ABC123.',
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(result.event_type, 'shipment');
  assert.equal(result.tracking_number, 'ABC123');
  assert.equal(requestBody?.model, 'gpt-5.4-nano');
  assert.equal(requestBody?.store, false);
  const text = requestBody?.text as { format?: { type?: string; strict?: boolean } };
  assert.equal(text.format?.type, 'json_schema');
  assert.equal(text.format?.strict, true);
});
