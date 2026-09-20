import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMailLensObservation } from './mail-lens-observation.js';
import type { NormalizedEmail } from '../email/types.js';

const base: NormalizedEmail = {
  provider: 'nylas', providerMessageId: 'synthetic', subject: 'Status update',
  from: [{ email: 'Orders@Shop.Example', name: 'Example Orders' }], to: [], cc: [], bcc: [],
  receivedAt: '2026-09-13T00:00:00Z', folders: [], attachments: [],
};

test('actual Responses request and validation evidence use the same MailLens text', async () => {
  const email = { ...base, bodyHtml: '<div style="display:none"><div>OLD</div>DELIVERED</div><p>ORDER-123 PROCESSING</p><blockquote><a href="https://old.example/">OLD DELIVERY</a></blockquote>' };
  const original = structuredClone(email);
  let request: any;
  const result = await extractMailLensObservation({
    email, apiKey: 'synthetic-key', model: 'synthetic-model',
    fetchImpl: (async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text',
        text: JSON.stringify({ event_type: 'other', shipment_phase: null, evidence_issues: [], confidence: 0.5, products: [], ...Object.fromEntries(['merchant', 'merchant_legal_name', 'order_number', 'subtotal', 'shipping_amount', 'discount_amount', 'total', 'currency', 'payment_status', 'payment_method', 'paid_amount', 'paid_currency', 'shipping_method', 'tracking_number', 'carrier', 'parcel_sender', 'cod_amount', 'cod_currency', 'invoice_number'].map(key => [key, null])) }),
      }] }] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(request.model, 'synthetic-model');
  assert.equal(request.input.split('Email body:\n')[1], result.evidence.bodyText);
  assert.equal(result.evidence.bodyText, 'ORDER-123 PROCESSING');
  assert.doesNotMatch(request.input, /DELIVERED|OLD|old.example/);
  assert.deepEqual(result.evidence.fromDomains, ['shop.example']);
  assert.deepEqual(result.evidence.from, ['Example Orders <Orders@Shop.Example>']);
  assert.equal(result.evidence.receivedAt, '2026-09-13T00:00:00Z');
  assert.match(request.input, /Received at: 2026-09-13T00:00:00Z/);
  assert.match(request.input, /From: Example Orders <Orders@Shop\.Example>/);
  assert.equal(result.evidence.normalization.version, 'mail-lens-text-v2');
  assert.deepEqual(email, original); // Archived provider evidence is unchanged.
});

test('quote-only mail does not reintroduce old evidence via the snippet at the AI boundary', async () => {
  let request: any;
  await assert.rejects(extractMailLensObservation({
    email: { ...base, subject: 'Re: DELIVERED', bodyHtml: '<blockquote>DELIVERED</blockquote>', snippet: 'DELIVERED' },
    apiKey: 'synthetic-key', model: 'synthetic-model',
    fetchImpl: (async (_url, init) => {
      request = JSON.parse(String(init?.body));
      throw new Error('synthetic stop after request inspection');
    }) as typeof fetch,
  }), /synthetic stop/);
  assert.equal(request.input.split('Email body:\n')[1], '');
  assert.doesNotMatch(request.input, /DELIVERED/);
});


test('full authored body wins over a short snippet and preserves late commerce evidence', async () => {
  const fullBody = [
    'Tisztelt Vásárló! Rendelését rögzítettük.',
    'Végösszeg: 10 054 Ft',
    'Megrendelés azonosító: 98691-106839',
    'Szállítási mód: ExpressOne házhoz szállítás',
    'Fizetési mód: Utánvétes fizetés',
  ].join('\n');
  let request: any;
  await assert.rejects(extractMailLensObservation({
    email: {
      ...base,
      subject: 'Automata megrendelés visszaigazolás - 98691-106839',
      snippet: 'SNIPPET_ONLY_SHOULD_NOT_WIN',
      bodyText: fullBody,
    },
    apiKey: 'synthetic-key',
    model: 'synthetic-model',
    fetchImpl: (async (_url, init) => {
      request = JSON.parse(String(init?.body));
      throw new Error('synthetic stop after request inspection');
    }) as typeof fetch,
  }), /synthetic stop/);

  assert.equal(request.input.split('Email body:\n')[1], fullBody);
  assert.match(request.input, /98691-106839/);
  assert.match(request.input, /10 054 Ft/);
  assert.match(request.input, /Utánvétes fizetés/);
  assert.doesNotMatch(request.input, /SNIPPET_ONLY_SHOULD_NOT_WIN/);
});


test('snippet-only fallback is marked insufficient instead of trusted as a full body', async () => {
  let request: any;
  const result = await extractMailLensObservation({
    email: {
      ...base,
      bodyText: undefined,
      bodyHtml: undefined,
      snippet: 'Rendelés visszaigazolva: 98691-106839',
    },
    apiKey: 'synthetic-key',
    model: 'synthetic-model',
    fetchImpl: (async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        event_type: 'other',
        shipment_phase: null,
        evidence_issues: [],
        confidence: 0.5,
        products: [],
        ...Object.fromEntries(['merchant', 'merchant_legal_name', 'order_number', 'subtotal', 'shipping_amount', 'discount_amount', 'total', 'currency', 'payment_status', 'payment_method', 'paid_amount', 'paid_currency', 'shipping_method', 'tracking_number', 'carrier', 'parcel_sender', 'cod_amount', 'cod_currency', 'invoice_number'].map(key => [key, null])),
      }) }));
    }) as typeof fetch,
  });

  assert.equal(result.evidence.normalization.bodyTextSource, 'snippet_fallback');
  assert.match(request.input, /"snippetOnly":true/);
  assert.deepEqual(result.result.extraction.evidence_issues, ['insufficient_evidence']);
});
