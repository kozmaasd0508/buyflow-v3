import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import type { NormalizedInboundPlan } from '../pipeline/normalized-inbound-pipeline.js';
import { canonicalEventFromNormalizedInbound } from './normalized-inbound-adapter.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: overrides.provider ?? 'mailgun',
    providerMessageId: overrides.providerMessageId ?? 'message-1',
    providerThreadId: overrides.providerThreadId,
    subject: overrides.subject ?? 'Rendelés visszaigazolás',
    from: overrides.from ?? [{ email: 'info@shop.hu' }],
    to: overrides.to ?? [{ email: 'bf-user@buyflow.hu' }],
    cc: overrides.cc ?? [],
    bcc: overrides.bcc ?? [],
    receivedAt: overrides.receivedAt ?? '2026-08-20T10:00:00.000Z',
    snippet: overrides.snippet,
    bodyHtml: overrides.bodyHtml,
    headers: overrides.headers,
    folders: overrides.folders ?? [],
    attachments: overrides.attachments ?? [],
  };
}

function plan(overrides: Partial<NormalizedInboundPlan> = {}): NormalizedInboundPlan {
  return {
    status: overrides.status ?? 'review',
    processingStatus: overrides.processingStatus ?? 'review',
    classification: overrides.classification ?? 'order_created',
    parserVersion: overrides.parserVersion ?? 'generic-commerce-v3-shadow',
    structuredResult: overrides.structuredResult ?? {
      merchant: 'Example Shop',
      order_number: 'AB-123',
      total: 14990,
      currency: 'HUF',
    },
    validatedResult: overrides.validatedResult ?? null,
    validationStatus: overrides.validationStatus ?? 'review',
  };
}

test('converts deterministic parser output into a canonical order event', () => {
  const event = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email(),
    plan: plan(),
    merchantResolver: {
      resolve: ({ merchantRaw }) => merchantRaw === 'Example Shop' ? 'example-shop' : null,
    },
  });

  assert.ok(event);
  assert.equal(event.eventType, 'order_created');
  assert.equal(event.sourceProvider, 'mailgun');
  assert.equal(event.senderDomain, 'shop.hu');
  assert.equal(event.merchantId, 'example-shop');
  assert.equal(event.orderIdRaw, 'AB-123');
  assert.equal(event.orderIdNormalized, 'AB123');
  assert.equal(event.amount, 14990);
  assert.equal(event.currency, 'HUF');
  assert.equal(event.provenance.some((item) => item.field === 'order_id'), true);
});

test('maps lifecycle classifications to v2 event types', () => {
  const shipment = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email(),
    plan: plan({ classification: 'shipment', structuredResult: { tracking_number: 'GLS-123' } }),
  });
  const delivery = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email({ providerMessageId: 'message-2' }),
    plan: plan({ classification: 'delivery', structuredResult: { tracking_number: 'GLS-123' } }),
  });
  const invoice = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email({ providerMessageId: 'message-3' }),
    plan: plan({ classification: 'invoice_or_receipt', structuredResult: { invoice_number: 'INV-42', order_number: 'AB-123' } }),
  });

  assert.equal(shipment?.eventType, 'shipment_created');
  assert.equal(shipment?.trackingIdNormalized, 'GLS123');
  assert.equal(delivery?.eventType, 'delivered');
  assert.equal(invoice?.eventType, 'invoice_created');
  assert.equal(invoice?.invoiceIdNormalized, 'INV42');
});

test('prefers validated result when available', () => {
  const event = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email(),
    plan: plan({
      structuredResult: { merchant: 'Wrong', order_number: 'OLD-1' },
      validatedResult: { merchant: 'Validated Shop', order_number: 'NEW-2', total: 5000, currency: 'HUF' },
    }),
  });

  assert.equal(event?.merchantRaw, 'Validated Shop');
  assert.equal(event?.orderIdNormalized, 'NEW2');
});

test('security classifications do not emit canonical commerce events', () => {
  const event = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email(),
    plan: plan({ classification: 'security_quarantine' }),
  });

  assert.equal(event, null);
});

test('does not perform merchant-specific subject correlation', () => {
  const event = canonicalEventFromNormalizedInbound({
    userId: 'user-1',
    email: email({ subject: 'Some completely unfamiliar webshop wording' }),
    plan: plan({ structuredResult: { merchant: 'Unknown Merchant', order_number: 'ZX-9' } }),
  });

  assert.equal(event?.merchantRaw, 'Unknown Merchant');
  assert.equal(event?.merchantId, null);
  assert.equal(event?.orderIdNormalized, 'ZX9');
});
