import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { NormalizedEmail } from '../email/types.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import { PHASE_D_FRESH_BLIND_FIXTURES, type PhaseDBlindFixture } from './phase-d-fresh-blind-fixtures.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from './types.js';

const USER_ID = 'phase-d-user';

function baseNorthwind(purchaseId = 'p-northwind', orderIdentityId = 'o-northwind'): PurchaseIdentitySnapshot {
  return {
    purchases: [{ purchaseId, userId: USER_ID, canonicalMerchantId: 'merchant:northwind', primaryOrderIdentityId: orderIdentityId, state: 'open' }],
    orders: [{
      orderIdentityId,
      purchaseId,
      merchantId: 'merchant:northwind',
      merchantNamespace: 'northwindoutfitters.com',
      orderId: 'NW-78431',
      relation: 'primary',
      parentOrderIdentityId: null,
    }],
    shipments: [],
    payments: [],
    invoices: [],
  };
}

function snapshotFor(key: PhaseDBlindFixture['snapshotKey']): PurchaseIdentitySnapshot {
  if (key === 'empty') return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
  if (key === 'northwind') return baseNorthwind();
  if (key === 'northwind-shipped') {
    const snapshot = baseNorthwind();
    snapshot.shipments.push({
      shipmentId: 's-northwind-dpd',
      purchaseId: 'p-northwind',
      carrierId: 'dpd',
      trackingId: '16380124267777',
      status: 'in_transit',
    });
    return snapshot;
  }
  if (key === 'northwind-payment') {
    const snapshot = baseNorthwind();
    snapshot.payments.push({
      paymentId: 'pay-northwind',
      purchaseId: 'p-northwind',
      providerId: null,
      paymentReference: 'PAY-55001',
      amount: 64.9,
      currency: 'EUR',
    });
    return snapshot;
  }
  if (key === 'blue-harbor') {
    return {
      purchases: [{ purchaseId: 'p-blue-harbor', userId: USER_ID, canonicalMerchantId: 'merchant:blue-harbor', primaryOrderIdentityId: 'o-blue-harbor', state: 'open' }],
      orders: [{
        orderIdentityId: 'o-blue-harbor',
        purchaseId: 'p-blue-harbor',
        merchantId: 'merchant:blue-harbor',
        merchantNamespace: 'blueharbormarket.com',
        orderId: 'BH-21980',
        relation: 'primary',
        parentOrderIdentityId: null,
      }],
      shipments: [],
      payments: [],
      invoices: [],
    };
  }

  const first = baseNorthwind('p-northwind-a', 'o-northwind-a');
  const second = baseNorthwind('p-northwind-b', 'o-northwind-b');
  return {
    purchases: [...first.purchases, ...second.purchases],
    orders: [...first.orders, ...second.orders],
    shipments: [],
    payments: [],
    invoices: [],
  };
}

function emailFor(fixture: PhaseDBlindFixture): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `phase-d-${fixture.id}`,
    subject: fixture.subject,
    from: [{ email: fixture.senderEmail, name: fixture.senderName }],
    to: [{ email: 'buyer@example.net', name: 'Buyer' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-25T21:00:00.000Z',
    snippet: fixture.body,
    headers: [],
    folders: ['inbox'],
    attachments: [],
  };
}

const merchantResolver = {
  resolve(input: { merchantRaw: string; senderDomain: string | null }) {
    const raw = input.merchantRaw.toLowerCase();
    const domain = input.senderDomain?.toLowerCase() ?? '';
    if (domain === 'northwindoutfitters.com' && raw.includes('northwind')) return 'merchant:northwind';
    if (domain === 'blueharbormarket.com' && raw.includes('blue harbor')) return 'merchant:blue-harbor';
    if (domain === 'othertrailshop.com' && raw.includes('other trail')) return 'merchant:other-trail';
    return null;
  },
};

const carrierResolver = {
  resolve(input: { carrierRaw: string }) {
    const value = input.carrierRaw.trim().toLowerCase();
    if (value === 'dpd') return 'dpd';
    if (value === 'dhl') return 'dhl';
    return value || null;
  },
};

test('Phase D fresh blind lifecycle audit preserves automatic-link precision', () => {
  const observations: Array<Record<string, unknown>> = [];
  const unsafe: string[] = [];
  let correctAutomatic = 0;
  let safeMisses = 0;
  let negativeControlsPassed = 0;

  for (const fixture of PHASE_D_FRESH_BLIND_FIXTURES) {
    const initial = snapshotFor(fixture.snapshotKey);
    const result = runPurchaseIdentityShadow({
      userId: USER_ID,
      document: buildEmailDocumentV1(emailFor(fixture)),
      snapshot: initial,
      merchantResolver,
      carrierResolver,
    });

    assert.equal(result.productionWrites, 0, `${fixture.id}: production write invariant`);
    assert.equal(result.aiCalls, 0, `${fixture.id}: AI invariant`);

    const decision = result.decision?.kind ?? null;
    const eventType = result.canonicalEvent?.eventType ?? null;
    const expectation = fixture.expectation;

    if (expectation.kind === 'positive_new_purchase') {
      if (decision === 'NEW_PURCHASE') {
        const expectedOrderNormalized = normalizeStableIdentifier(expectation.expectedOrderId);
        const createdOrder = result.simulatedSnapshot.orders.find((order) =>
          normalizeStableIdentifier(order.orderId) === expectedOrderNormalized
        );
        if (!createdOrder) unsafe.push(`${fixture.id}: NEW_PURCHASE created without expected order identity`);
        else correctAutomatic += 1;
      } else if (decision === 'LINKED') {
        unsafe.push(`${fixture.id}: linked instead of creating the expected new purchase`);
      } else {
        safeMisses += 1;
      }
    } else if (expectation.kind === 'positive_link') {
      if (decision === 'LINKED') {
        const linkedPurchaseId = result.decision?.kind === 'LINKED' ? result.decision.purchaseId : null;
        if (linkedPurchaseId !== expectation.expectedPurchaseId) {
          unsafe.push(`${fixture.id}: linked to ${linkedPurchaseId ?? 'null'} instead of ${expectation.expectedPurchaseId}`);
        } else {
          const purchase = result.simulatedSnapshot.purchases.find((item) => item.purchaseId === expectation.expectedPurchaseId);
          if (expectation.expectedState && purchase?.state !== expectation.expectedState) {
            unsafe.push(`${fixture.id}: linked correctly but state was ${purchase?.state ?? 'missing'}, expected ${expectation.expectedState}`);
          } else if (expectation.expectedShipmentStatus && !result.simulatedSnapshot.shipments.some((shipment) =>
            shipment.purchaseId === expectation.expectedPurchaseId && shipment.status === expectation.expectedShipmentStatus
          )) {
            unsafe.push(`${fixture.id}: linked correctly but expected shipment status was not projected`);
          } else if (expectation.requireInvoice && !result.simulatedSnapshot.invoices.some((invoice) => invoice.purchaseId === expectation.expectedPurchaseId)) {
            unsafe.push(`${fixture.id}: linked correctly but invoice identity was not projected`);
          } else if (expectation.requirePayment && !result.simulatedSnapshot.payments.some((payment) => payment.purchaseId === expectation.expectedPurchaseId)) {
            unsafe.push(`${fixture.id}: linked correctly but payment identity was not projected`);
          } else {
            correctAutomatic += 1;
          }
        }
      } else if (decision === 'NEW_PURCHASE') {
        unsafe.push(`${fixture.id}: lifecycle event created a second Purchase`);
      } else {
        safeMisses += 1;
      }
    } else if (expectation.kind === 'negative_no_auto_create') {
      if (decision === 'NEW_PURCHASE') unsafe.push(`${fixture.id}: shared/platform sender created a Purchase`);
      else negativeControlsPassed += 1;
    } else if (expectation.kind === 'negative_no_auto_link') {
      if (decision === 'LINKED') {
        const linkedPurchaseId = result.decision?.kind === 'LINKED' ? result.decision.purchaseId : null;
        unsafe.push(`${fixture.id}: unexpectedly auto-linked to ${linkedPurchaseId ?? 'unknown'}`);
      } else if (decision === 'NEW_PURCHASE') {
        unsafe.push(`${fixture.id}: negative lifecycle/provider control created a Purchase`);
      } else {
        negativeControlsPassed += 1;
      }
    } else {
      const purchase = result.simulatedSnapshot.purchases.find((item) => item.purchaseId === expectation.expectedPurchaseId);
      if (decision === 'NEW_PURCHASE') {
        unsafe.push(`${fixture.id}: refund-initiation control created a Purchase`);
      } else if (decision === 'LINKED' && purchase?.state === 'refunded') {
        unsafe.push(`${fixture.id}: refund initiation was promoted to completed refund state`);
      } else {
        negativeControlsPassed += 1;
      }
    }

    observations.push({
      id: fixture.id,
      eventType,
      decision,
      mutated: result.simulatedGraphMutated,
    });
  }

  console.log('PHASE_D_FRESH_BLIND_SCORE', JSON.stringify({
    fixtures: PHASE_D_FRESH_BLIND_FIXTURES.length,
    correctAutomatic,
    safeMisses,
    negativeControlsPassed,
    unsafe,
    observations,
  }));

  assert.deepEqual(unsafe, []);
});
