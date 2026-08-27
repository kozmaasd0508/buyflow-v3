import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { UnresolvedEventPool } from '../purchase-identity-v2/unresolved-event-pool.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';
import {
  buildBuyFlowEvidencePacketV1,
  extractSpfVerdict,
  serializeBuyFlowEvidencePacketV1,
  summarizeEvidencePacketV1,
} from './evidence-packet.js';
import type { PurchaseJourneyMemoryEvent } from './purchase-journey-context.js';

function document(): EmailDocumentV1 {
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context":"https://schema.org",
            "@type":"Order",
            "orderNumber":"ORD-123",
            "seller":{"@type":"Organization","name":"Example Shop"},
            "orderDelivery":{"@type":"ParcelDelivery","trackingNumber":"TRACK123"}
          }
        </script>
      </head>
      <body>
        <div itemscope itemtype="https://schema.org/Order">
          <meta itemprop="orderNumber" content="ORD-123">
          <span itemprop="merchant">Example Shop</span>
        </div>
        <table><tr><td>Order ORD-123</td><td>12 990 Ft</td></tr></table>
        <a href="https://shop.example/orders/ORD-123?tracking=TRACK123">Track order</a>
      </body>
    </html>`;

  return {
    schemaVersion: 1,
    provider: 'gmail',
    providerMessageId: 'message-current',
    receivedAt: '2026-08-27T20:00:00Z',
    sender: {
      addresses: [{ email: 'orders@shop.example', name: 'Example Shop' }],
      domains: ['shop.example'],
      primaryEmail: 'orders@shop.example',
      primaryDomain: 'shop.example',
      primaryName: 'Example Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject: 'Order ORD-123 confirmed',
    text: 'Order ORD-123 confirmed\nTotal: 12 990 Ft\nhttps://shop.example/orders/ORD-123?tracking=TRACK123',
    html,
    headers: [
      { name: 'Reply-To', value: 'Support <help@shop.example>' },
      { name: 'Return-Path', value: '<bounce@mailer.shop.example>' },
      { name: 'Authentication-Results', value: 'mx.example; dkim=pass header.d=shop.example; spf=pass smtp.mailfrom=mailer.shop.example' },
    ],
    attachments: [{ id: 'a1', filename: 'invoice.pdf', contentType: 'application/pdf' }],
    sections: [{ type: 'order_summary', text: 'Order ORD-123 confirmed' }],
    signals: {
      orderNumbers: ['ORD-123'],
      trackingNumbers: ['TRACK123'],
      amounts: [{ amount: 12990, currency: 'HUF', raw: '12 990 Ft' }],
      shippingAmounts: [],
      codAmounts: [],
      products: [{
        name: 'Example Product',
        quantity: 1,
        raw: '1 x Example Product',
        unitPrice: 12990,
        totalPrice: 12990,
        currency: 'HUF',
      }],
      couriers: ['Express One'],
      paymentMethods: ['Bank card'],
      shippingMethods: ['Courier'],
    },
  };
}

function purchaseSnapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [
      { purchaseId: 'p-user-1', userId: 'user-1', canonicalMerchantId: null, primaryOrderIdentityId: 'o1', state: 'open' },
      { purchaseId: 'p-user-2', userId: 'user-2', canonicalMerchantId: null, primaryOrderIdentityId: 'o2', state: 'open' },
    ],
    orders: [
      { orderIdentityId: 'o1', purchaseId: 'p-user-1', merchantId: null, merchantNamespace: 'sender-domain:shop.example', orderId: 'ORD-123', relation: 'primary', parentOrderIdentityId: null },
      { orderIdentityId: 'o2', purchaseId: 'p-user-2', merchantId: null, merchantNamespace: 'sender-domain:shop.example', orderId: 'ORD-123', relation: 'primary', parentOrderIdentityId: null },
    ],
    shipments: [],
    payments: [],
    invoices: [],
  };
}

function lifecycleEvent(userId: string, eventId: string): CanonicalEvent {
  return {
    eventId,
    userId,
    eventType: 'delivered',
    sourceProvider: 'gmail',
    sourceMessageId: `message-${eventId}`,
    senderDomain: 'carrier.example',
    receivedAt: '2026-08-27T19:00:00Z',
    occurredAt: null,
    merchantRaw: null,
    merchantId: null,
    merchantNamespace: null,
    orderIdRaw: null,
    orderIdNormalized: null,
    trackingIdRaw: 'TRACK123',
    trackingIdNormalized: 'TRACK123',
    invoiceIdRaw: null,
    invoiceIdNormalized: null,
    paymentReference: null,
    amount: null,
    currency: null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: [],
    sourceRole: 'carrier',
    carrierId: 'express-one',
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
  };
}

function unresolvedSnapshot() {
  const pool = new UnresolvedEventPool();
  const decision = { kind: 'UNLINKED' as const, reasons: [] };
  pool.remember(lifecycleEvent('user-1', 'unresolved-user-1'), decision);
  pool.remember(lifecycleEvent('user-2', 'unresolved-user-2'), decision);
  return pool.snapshot();
}

function priorEvents(): PurchaseJourneyMemoryEvent[] {
  return [
    {
      purchaseId: 'p-user-1',
      eventType: 'order_created',
      receivedAt: '2026-08-27T18:00:00Z',
      sourceRole: 'merchant',
      merchantNamespace: 'sender-domain:shop.example',
      orderId: 'ORD-123',
      trackingId: null,
      carrierId: null,
      invoiceId: null,
      paymentReference: null,
      amount: 12990,
      currency: 'HUF',
    },
    {
      purchaseId: 'p-user-2',
      eventType: 'order_created',
      receivedAt: '2026-08-27T18:00:00Z',
      sourceRole: 'merchant',
      merchantNamespace: 'sender-domain:shop.example',
      orderId: 'ORD-123',
      trackingId: null,
      carrierId: null,
      invoiceId: null,
      paymentReference: null,
      amount: 12990,
      currency: 'HUF',
    },
  ];
}

test('builds one user-scoped evidence packet with auth, HTML, URLs, structured data and deterministic signals', () => {
  const packet = buildBuyFlowEvidencePacketV1({
    userId: 'user-1',
    document: document(),
    purchaseSnapshot: purchaseSnapshot(),
    priorEvents: priorEvents(),
    unresolvedSnapshot: unresolvedSnapshot(),
  });

  assert.deepEqual(packet.currentEmail.authentication.dkimPassDomains, ['shop.example']);
  assert.deepEqual(packet.currentEmail.authentication.replyToDomains, ['shop.example']);
  assert.deepEqual(packet.currentEmail.authentication.returnPathDomains, ['mailer.shop.example']);
  assert.equal(packet.currentEmail.authentication.spf, 'pass');

  assert.equal(packet.currentEmail.urls.length, 1);
  assert.equal(packet.currentEmail.urls[0]?.host, 'shop.example');
  assert.match(packet.currentEmail.htmlStructure ?? '', /\[TABLE\]/);
  assert.doesNotMatch(packet.currentEmail.htmlStructure ?? '', /application\/ld\+json/i);

  assert.deepEqual(packet.currentEmail.structuredData.schemaOrgTypes, ['Order', 'Organization', 'ParcelDelivery']);
  assert.equal(packet.currentEmail.structuredData.jsonLd.length, 1);
  assert.match(packet.currentEmail.structuredData.jsonLd[0]?.json ?? '', /ORD-123/);
  assert.ok(packet.currentEmail.structuredData.microdata.itemProperties.includes('orderNumber'));
  assert.ok(packet.currentEmail.structuredData.microdata.values.some((item) => item.property === 'orderNumber' && item.value === 'ORD-123'));
  assert.ok(packet.currentEmail.structuredData.technicalEvidence.some((row) => row.source === 'structured_data'));

  assert.deepEqual(packet.currentEmail.deterministicSignals.orderIds, ['ORD-123']);
  assert.deepEqual(packet.currentEmail.deterministicSignals.trackingIds, ['TRACK123']);
  assert.equal(packet.currentEmail.deterministicSignals.amounts[0]?.amount, 12990);
  assert.equal(packet.currentEmail.deterministicSignals.products[0]?.name, 'Example Product');
  assert.deepEqual(packet.currentEmail.deterministicSignals.carriers, ['Express One']);

  assert.equal(packet.priorJourney.verified.candidateCount, 1);
  assert.equal(packet.priorJourney.verified.candidates[0]?.purchaseId, 'p-user-1');
  assert.equal(packet.priorJourney.verified.candidates[0]?.recentEvents.length, 1);
  assert.deepEqual(packet.priorJourney.unresolved.map((item) => item.eventId), ['unresolved-user-1']);
});

test('privacy summary contains counts and verdicts but not raw email identifiers', () => {
  const packet = buildBuyFlowEvidencePacketV1({
    userId: 'user-1',
    document: document(),
    purchaseSnapshot: purchaseSnapshot(),
    priorEvents: priorEvents(),
    unresolvedSnapshot: unresolvedSnapshot(),
  });
  const summary = summarizeEvidencePacketV1(packet);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.jsonLdBlockCount, 1);
  assert.equal(summary.microdataValueCount > 0, true);
  assert.equal(summary.verifiedCandidateCount, 1);
  assert.equal(summary.unresolvedCount, 1);
  assert.equal(summary.authentication.spf, 'pass');
  assert.doesNotMatch(serialized, /ORD-123|TRACK123|orders@shop\.example|message-current/);
});

test('raw packet serialization is explicitly complete model input and preserves current evidence', () => {
  const packet = buildBuyFlowEvidencePacketV1({ userId: 'user-1', document: document() });
  const serialized = serializeBuyFlowEvidencePacketV1(packet);
  assert.match(serialized, /ORD-123/);
  assert.match(serialized, /TRACK123/);
  assert.match(serialized, /shop\.example/);
});

test('malformed JSON-LD is ignored rather than trusted or crashing packet construction', () => {
  const current = document();
  current.html = '<script type="application/ld+json">{not-json}</script><div itemprop="orderNumber">SAFE-1</div>';
  const packet = buildBuyFlowEvidencePacketV1({ userId: 'user-1', document: current });
  assert.equal(packet.currentEmail.structuredData.jsonLd.length, 0);
  assert.ok(packet.currentEmail.structuredData.microdata.itemProperties.includes('orderNumber'));
});

test('SPF parser fails closed to unknown for missing or unsupported evidence', () => {
  assert.equal(extractSpfVerdict([]), 'unknown');
  assert.equal(extractSpfVerdict([{ name: 'Authentication-Results', value: 'mx; spf=fail smtp.mailfrom=bad.example' }]), 'fail');
});
