import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractEmailWithOpenAI,
  extractEmailWithOpenAIResult,
  htmlToCompactText,
} from './openai-email-extractor.js';

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'shipment',
    merchant: null,
    merchant_legal_name: null,
    order_number: null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.95,
    ...overrides,
  };
}

test('compacts email HTML without scripts and styles', () => {
  const result = htmlToCompactText('<style>x{}</style><p>Hello&nbsp;<b>world</b></p><script>bad()</script>');
  assert.equal(result, 'Hello world');
});

test('preserves explicit product links while compacting order HTML', () => {
  const result = htmlToCompactText('<p><a href="https://shop.example/p/sku-1">Termék neve</a></p>');
  assert.match(result, /Termék neve/);
  assert.match(result, /https:\/\/shop\.example\/p\/sku-1/);
});

test('requests strict V2 structured output with purchased products', async () => {
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
                text: JSON.stringify(extraction({
                  event_type: 'order_created',
                  merchant: 'Example Shop',
                  order_number: 'ORD-1',
                  total: 12990,
                  currency: 'HUF',
                  products: [
                    {
                      name: 'Example Product',
                      brand: 'Example',
                      model: null,
                      variant: null,
                      sku: 'SKU-1',
                      gtin: null,
                      category: null,
                      quantity: 1,
                      unit_price: 12990,
                      total_price: 12990,
                      currency: 'HUF',
                      product_url: 'https://shop.example/p/sku-1',
                      image_url: null,
                      confidence: 0.98,
                    },
                  ],
                  confidence: 0.98,
                })),
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
    bodyText: 'Order ORD-1. Example Product SKU-1 12 990 HUF.',
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(result.event_type, 'order_created');
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0]?.sku, 'SKU-1');
  assert.equal(requestBody?.model, 'gpt-5.4-nano');
  assert.equal(requestBody?.store, false);
  const text = requestBody?.text as {
    format?: {
      type?: string;
      strict?: boolean;
      name?: string;
      schema?: { properties?: Record<string, unknown> };
    };
  };
  assert.equal(text.format?.type, 'json_schema');
  assert.equal(text.format?.strict, true);
  assert.equal(text.format?.name, 'buyflow_email_extraction_v2');
  assert.ok(text.format?.schema?.properties?.products);
  assert.match(String(requestBody?.instructions ?? ''), /every purchased line item/i);
});

test('known carrier senders keep parcel sender and COD evidence but cannot produce purchase fields', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: 'resp_carrier',
        output_text: JSON.stringify(extraction({
          event_type: 'delivery',
          tracking_number: 'TRACK-1',
          carrier: 'GLS',
          parcel_sender: 'Example Shop Kft.',
          cod_amount: 0,
          cod_currency: 'HUF',
          confidence: 0.98,
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await extractEmailWithOpenAI({
    apiKey: 'test-key',
    subject: 'GLS kézbesítés',
    fromDomains: ['gls-hungary.com'],
    bodyText: 'Feladó: Example Shop Kft. Csomagszám: TRACK-1 Utánvét összeg: 0 HUF',
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.equal(result.parcel_sender, 'Example Shop Kft.');
  assert.equal(result.cod_amount, 0);

  const text = requestBody?.text as {
    format?: {
      schema?: {
        properties?: Record<string, { type?: unknown; enum?: string[]; maxItems?: number }>;
      };
    };
  };
  const properties = text.format?.schema?.properties ?? {};
  assert.equal(properties.merchant?.type, 'null');
  assert.equal(properties.order_number?.type, 'null');
  assert.equal(properties.total?.type, 'null');
  assert.equal(properties.payment_status?.type, 'null');
  assert.equal(properties.products?.maxItems, 0);
  assert.equal(properties.event_type?.enum?.includes('order_created'), false);
  assert.equal(properties.event_type?.enum?.includes('order_updated'), false);
  assert.equal(properties.event_type?.enum?.includes('payment_completed'), false);
  assert.match(String(requestBody?.instructions ?? ''), /parcel_sender/i);
  assert.match(String(requestBody?.input ?? ''), /Sender role: carrier/);
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
        output_text: JSON.stringify(extraction({
          event_type: 'invoice_or_receipt',
          merchant: 'Example',
          invoice_number: 'INV-1',
          total: 12.34,
          currency: 'EUR',
          confidence: 0.91,
        })),
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
