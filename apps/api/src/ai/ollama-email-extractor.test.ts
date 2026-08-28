import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmailWithOllamaResult } from './ollama-email-extractor.js';

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'order_created',
    merchant: 'GymBeam',
    merchant_legal_name: null,
    order_number: '#12345',
    subtotal: 14990,
    shipping_amount: 0,
    discount_amount: null,
    total: 14990,
    currency: 'HUF',
    payment_status: 'cash_on_delivery',
    payment_method: 'utánvét',
    paid_amount: 0,
    paid_currency: 'HUF',
    shipping_method: null,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: 14990,
    cod_currency: 'HUF',
    invoice_number: null,
    products: [],
    confidence: 0.98,
    ...overrides,
  };
}

test('calls local Ollama with structured output and normalizes order number', async () => {
  let capturedUrl = '';
  let capturedBody: any;

  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: JSON.stringify(extraction()),
        },
        done: true,
        prompt_eval_count: 812,
        eval_count: 94,
        total_duration: 1_250_000_000,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await extractEmailWithOllamaResult({
    model: 'qwen3:30b',
    baseUrl: 'http://127.0.0.1:11434/',
    subject: 'Rendelésedet megkaptuk – #12345',
    fromDomains: ['service.gymbeam.hu'],
    bodyText: 'Rendelés: #12345\nÖsszesen: 14 990 Ft',
    fetchImpl,
  });

  assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(capturedBody.model, 'qwen3:30b');
  assert.equal(capturedBody.stream, false);
  assert.equal(capturedBody.think, false);
  assert.equal(capturedBody.options.temperature, 0);
  assert.equal(capturedBody.format.type, 'object');
  assert.ok(capturedBody.format.properties.event_type.enum.includes('order_created'));
  assert.equal(result.extraction.order_number, '12345');
  assert.equal(result.extraction.event_type, 'order_created');
  assert.equal(result.promptTokens, 812);
  assert.equal(result.outputTokens, 94);
  assert.equal(result.totalDurationMs, 1250);
});

test('carrier sender schema blocks merchant/order purchase fields', async () => {
  let capturedBody: any;

  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: JSON.stringify(extraction({
            event_type: 'delivery',
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
            tracking_number: 'ABC987654',
            carrier: 'Express One',
            parcel_sender: 'GymBeam',
            cod_amount: null,
            cod_currency: null,
            products: [],
          })),
        },
        done: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await extractEmailWithOllamaResult({
    fromDomains: ['expressone.hu'],
    subject: 'Csomagod kézbesítettük',
    bodyText: 'Nyomkövetés: ABC987654\nFeladó: GymBeam',
    fetchImpl,
  });

  assert.deepEqual(capturedBody.format.properties.merchant, { type: 'null' });
  assert.deepEqual(capturedBody.format.properties.order_number, { type: 'null' });
  assert.ok(!capturedBody.format.properties.event_type.enum.includes('order_created'));
  assert.equal(result.extraction.event_type, 'delivery');
  assert.equal(result.extraction.tracking_number, 'ABC987654');
  assert.equal(result.extraction.parcel_sender, 'GymBeam');
});

test('fails closed on malformed Ollama JSON', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({ message: { role: 'assistant', content: 'not-json' }, done: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  await assert.rejects(
    () => extractEmailWithOllamaResult({ bodyText: 'hello', fetchImpl }),
    /not valid JSON/,
  );
});
