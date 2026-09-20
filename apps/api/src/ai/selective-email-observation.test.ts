import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import type { EmailExtraction } from './openai-email-extractor.js';
import { extractWithSelectiveSolVerification, mergeVerifiedExtraction, sumAiUsage } from './selective-email-observation.js';

const email: NormalizedEmail = {
  provider: 'nylas',
  providerMessageId: 'mail-1',
  subject: 'Synthetic',
  from: [{ email: 'orders@example.com' }],
  to: [{ email: 'user@example.com' }],
  cc: [],
  bcc: [],
  receivedAt: '2026-09-20T12:00:00.000Z',
  bodyText: 'Synthetic authored body',
  folders: [],
  attachments: [],
};

function extraction(overrides: Partial<EmailExtraction> = {}): EmailExtraction {
  return {
    event_type: 'shipment',
    shipment_phase: 'shipped',
    evidence_issues: [],
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
    tracking_number: 'TRACK-1',
    carrier: 'Carrier',
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
    ...overrides,
  };
}

function observation(x: EmailExtraction, responseId: string) {
  return {
    result: {
      extraction: x,
      responseId,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 40,
    },
    evidence: {
      subject: 'Synthetic',
      from: ['Shop <orders@example.com>'],
      receivedAt: '2026-09-20T12:00:00.000Z',
      fromDomains: ['example.com'],
      bodyText: 'Synthetic authored body',
      normalization: {
        bodyTextSource: 'provider_text',
        bodyTextTruncated: false,
        semanticTextTruncated: false,
      },
    },
  } as any;
}

test('safe Luna result remains one-call Luna-only', async () => {
  const calls: string[] = [];
  const result = await extractWithSelectiveSolVerification({
    email, apiKey: 'key', primaryModel: 'gpt-5.6-luna', verifierEnabled: true,
  }, {
    extract: (async (input: any) => {
      calls.push(input.model);
      return observation(extraction(), 'luna');
    }) as any,
  });

  assert.deepEqual(calls, ['gpt-5.6-luna']);
  assert.equal(result.aiCalls, 1);
  assert.equal(result.selectedModel, 'gpt-5.6-luna');
  assert.equal(result.verification.attempted, false);
  assert.equal(result.verification.selectionStrategy, 'luna_only');
});

test('risky Luna result is verified by Sol and successful Sol becomes selected', async () => {
  const calls: string[] = [];
  const result = await extractWithSelectiveSolVerification({
    email, apiKey: 'key', primaryModel: 'gpt-5.6-luna',
    verifierEnabled: true, verifierModel: 'gpt-5.6-sol',
  }, {
    extract: (async (input: any) => {
      calls.push(input.model);
      return input.model === 'gpt-5.6-luna'
        ? observation(extraction({ event_type: 'shipment', shipment_phase: null, confidence: 0.98 }), 'luna')
        : observation(extraction({ event_type: 'shipment', shipment_phase: 'out_for_delivery' }), 'sol');
    }) as any,
  });

  assert.deepEqual(calls, ['gpt-5.6-luna', 'gpt-5.6-sol']);
  assert.equal(result.aiCalls, 2);
  assert.equal(result.selectedModel, 'gpt-5.6-sol');
  assert.equal(result.selected.result.responseId, 'sol');
  assert.equal(result.verification.completed, true);
  assert.equal(result.verification.coreAgreement, false);
  assert.equal(result.verification.selectionStrategy, 'sol_semantic_merge');
  assert.ok(result.verification.reasons.includes('shipment_phase_missing'));
});

test('Sol verifier failure falls back to Luna shadow observation', async () => {
  const result = await extractWithSelectiveSolVerification({
    email, apiKey: 'key', primaryModel: 'gpt-5.6-luna',
    verifierEnabled: true, verifierModel: 'gpt-5.6-sol',
  }, {
    extract: (async (input: any) => {
      if (input.model === 'gpt-5.6-sol') throw new TypeError('synthetic verifier failure');
      return observation(extraction({ event_type: 'order_updated', shipment_phase: null }), 'luna');
    }) as any,
  });

  assert.equal(result.aiCalls, 2);
  assert.equal(result.selectedModel, 'gpt-5.6-luna');
  assert.equal(result.selected.result.responseId, 'luna');
  assert.equal(result.verification.attempted, true);
  assert.equal(result.verification.completed, false);
  assert.equal(result.verification.verifierErrorType, 'TypeError');
  assert.equal(result.verification.selectionStrategy, 'luna_fallback');
});

test('combined usage accounts for both model calls', () => {
  const primary = observation(extraction(), 'luna').result;
  const verifier = observation(extraction(), 'sol').result;
  assert.deepEqual(sumAiUsage(primary, verifier), {
    inputTokens: 200,
    outputTokens: 40,
    totalTokens: 240,
    cachedInputTokens: 80,
  });
  assert.deepEqual(sumAiUsage(primary, null), {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 40,
  });
});


test('semantic merge keeps Luna commerce fields while accepting Sol event boundary', () => {
  const primary = extraction({
    event_type: 'shipment',
    shipment_phase: 'shipment_created',
    order_number: 'ORDER-1',
    tracking_number: 'TRACK-1',
    payment_status: 'cash_on_delivery',
    invoice_number: null,
    confidence: 0.99,
  });
  const verifier = extraction({
    event_type: 'order_updated',
    shipment_phase: null,
    order_number: 'ORDER-2',
    tracking_number: null,
    payment_status: null,
    invoice_number: 'INV-1',
    confidence: 0.97,
  });

  const merged = mergeVerifiedExtraction(primary, verifier);
  assert.equal(merged.event_type, 'order_updated');
  assert.equal(merged.shipment_phase, null);
  assert.equal(merged.order_number, 'ORDER-1');
  assert.equal(merged.tracking_number, 'TRACK-1');
  assert.equal(merged.payment_status, 'cash_on_delivery');
  assert.equal(merged.invoice_number, 'INV-1');
  assert.equal(merged.confidence, 0.97);
});

test('selective verification does not let Sol erase a correct Luna payment status', async () => {
  const result = await extractWithSelectiveSolVerification({
    email, apiKey: 'key', primaryModel: 'gpt-5.6-luna',
    verifierEnabled: true, verifierModel: 'gpt-5.6-sol',
  }, {
    extract: (async (input: any) => input.model === 'gpt-5.6-luna'
      ? observation(extraction({
          event_type: 'shipment',
          shipment_phase: 'shipment_created',
          order_number: 'ORDER-1',
          tracking_number: 'TRACK-1',
          payment_status: 'cash_on_delivery',
        }), 'luna')
      : observation(extraction({
          event_type: 'order_updated',
          shipment_phase: null,
          order_number: 'ORDER-1',
          tracking_number: 'TRACK-1',
          payment_status: null,
        }), 'sol')) as any,
  });

  assert.equal(result.selected.result.extraction.event_type, 'order_updated');
  assert.equal(result.selected.result.extraction.shipment_phase, null);
  assert.equal(result.selected.result.extraction.payment_status, 'cash_on_delivery');
  assert.equal(result.verification.selectionStrategy, 'sol_semantic_merge');
});
