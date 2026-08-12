import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractEmailWithOpenAI,
  extractEmailWithOpenAIResult,
  htmlToCompactText,
} from './openai-email-extractor.js';

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
        id: 'resp_test_123',
        usage: {
          input_tokens: 321,
          output_tokens: 42,
          total_tokens: 363,
          input_tokens_details: { cached_tokens: 25 },
        },
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

test('captures response id and token usage without changing extraction shape', async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        id: 'resp_test_usage',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 10 },
        },
        output_text: JSON.stringify({
          event_type: 'invoice_or_receipt',
          merchant: 'Example',
          order_number: null,
          tracking_number: null,
          carrier: null,
          invoice_number: 'INV-1',
          total: 12.34,
          currency: 'EUR',
          confidence: 0.91,
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const result = await extractEmailWithOpenAIResult({
    apiKey: 'test-key',
    bodyText: 'Invoice INV-1 total EUR 12.34',
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(result.extraction.event_type, 'invoice_or_receipt');
  assert.equal(result.responseId, 'resp_test_usage');
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.totalTokens, 120);
  assert.equal(result.cachedInputTokens, 10);
});
