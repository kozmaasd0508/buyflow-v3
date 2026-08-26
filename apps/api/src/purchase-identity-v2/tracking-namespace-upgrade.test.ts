import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseIdentityGraph } from './graph.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from './types.js';

function snapshot(shipments: PurchaseIdentitySnapshot['shipments']): PurchaseIdentitySnapshot {
  const purchaseIds = [...new Set(shipments.map((shipment) => shipment.purchaseId))];
  return {
    purchases: purchaseIds.map((purchaseId) => ({
      purchaseId,
      userId: 'u1',
      canonicalMerchantId: null,
      primaryOrderIdentityId: null,
      state: 'open' as const,
    })),
    orders: [],
    shipments,
    payments: [],
    invoices: [],
  };
}

function carrierEvent(carrierId: string): CanonicalEvent {
  return {
    eventId: 'event:delivery',
    userId: 'u1',
    eventType: 'delivered',
    sourceProvider: 'gmail',
    sourceMessageId: 'm-delivery',
    senderDomain: 'carrier.example',
    receivedAt: '2026-08-26T20:00:00.000Z',
    occurredAt: null,
    merchantRaw: null,
    merchantId: null,
    merchantNamespace: null,
    purchaseCreationAuthority: 'none',
    purchaseCreationReasons: ['not_order_created'],
    orderRelation: null,
    orderIdRaw: null,
    orderIdNormalized: null,
    trackingIdRaw: 'TRK-001-ABC',
    trackingIdNormalized: 'TRK001ABC',
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
    carrierId,
    paymentProviderId: null,
    invoiceIssuerId: null,
    platformMerchantId: null,
    sellerMerchantId: null,
    conflicts: [],
  };
}

test('known carrier can safely upgrade one unique previously-unscoped tracking journey', () => {
  const graph = new PurchaseIdentityGraph(snapshot([
    {
      shipmentId: 'shipment:p1:unknown:TRK001ABC',
      purchaseId: 'p1',
      carrierId: null,
      trackingId: 'TRK-001-ABC',
      status: 'in_transit',
    },
  ]));

  const result = graph.applyEvent(carrierEvent('express-one'));
  assert.equal(result.decision.kind, 'LINKED');
  if (result.decision.kind !== 'LINKED') return;
  assert.equal(result.decision.purchaseId, 'p1');
  assert.ok(result.decision.reasons.some((edge) => edge.evidenceType === 'TRACKING_ID_EXACT' && edge.strength === 'hard'));

  const shipment = result.snapshot.shipments.find((item) => item.purchaseId === 'p1');
  assert.equal(shipment?.carrierId, 'express-one');
  assert.equal(shipment?.status, 'delivered');
  assert.equal(result.snapshot.purchases[0]?.state, 'fulfilled');
});

test('same unscoped tracking on multiple purchases never auto-links', () => {
  const graph = new PurchaseIdentityGraph(snapshot([
    {
      shipmentId: 'shipment:p1:unknown:TRK001ABC',
      purchaseId: 'p1',
      carrierId: null,
      trackingId: 'TRK-001-ABC',
      status: 'in_transit',
    },
    {
      shipmentId: 'shipment:p2:unknown:TRK001ABC',
      purchaseId: 'p2',
      carrierId: null,
      trackingId: 'TRK-001-ABC',
      status: 'in_transit',
    },
  ]));

  const result = graph.applyEvent(carrierEvent('express-one'));
  assert.equal(result.decision.kind, 'REVIEW');
  assert.equal(result.mutated, false);
});

test('conflicting known carrier namespace never auto-upgrades tracking', () => {
  const graph = new PurchaseIdentityGraph(snapshot([
    {
      shipmentId: 'shipment:p1:gls:TRK001ABC',
      purchaseId: 'p1',
      carrierId: 'gls',
      trackingId: 'TRK-001-ABC',
      status: 'in_transit',
    },
  ]));

  const result = graph.applyEvent(carrierEvent('express-one'));
  assert.equal(result.decision.kind, 'REVIEW');
  assert.equal(result.mutated, false);
});
