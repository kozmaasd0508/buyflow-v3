import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { NormalizedEmail } from '../email/types.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import {
  PHASE_E_REAL_DERIVED_FIXTURES,
  type PhaseERealDerivedFixture,
} from './phase-e-real-derived-fixtures.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from './types.js';

const USER_ID = 'phase-e-real-derived-user';

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function cedarOrderSnapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [{
      purchaseId: 'p-cedar',
      userId: USER_ID,
      canonicalMerchantId: 'merchant:cedar-gate',
      primaryOrderIdentityId: 'o-cedar',
      state: 'open',
    }],
    orders: [{
      orderIdentityId: 'o-cedar',
      purchaseId: 'p-cedar',
      merchantId: 'merchant:cedar-gate',
      merchantNamespace: 'cedargate-shop.example',
      orderId: 'CG20336215',
      relation: 'primary',
      parentOrderIdentityId: null,
    }],
    shipments: [],
    payments: [],
    invoices: [],
  };
}

function snapshotFor(key: PhaseERealDerivedFixture['snapshotKey']): PurchaseIdentitySnapshot {
  return key === 'cedar-order' ? cedarOrderSnapshot() : emptySnapshot();
}

function emailFor(fixture: PhaseERealDerivedFixture): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `phase-e-real-derived-${fixture.id}`,
    subject: fixture.subject,
    from: [{ email: fixture.senderEmail, name: fixture.senderName }],
    to: [{ email: 'buyer@example.net', name: 'Buyer' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-07-31T12:00:00.000Z',
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
    if (domain === 'cedargate-shop.example' && raw.includes('cedar gate')) return 'merchant:cedar-gate';
    return null;
  },
};

const carrierResolver = {
  resolve(input: { carrierRaw: string }) {
    const value = input.carrierRaw.trim().toLowerCase();
    if (value.includes('parcelbox')) return 'parcelbox';
    if (value.includes('parcel network')) return 'parcel-network';
    if (value.includes('parcel express')) return 'parcel-express';
    return value || null;
  },
};

test('Phase E fresh real-derived replay never promotes unsafe events', () => {
  const observations: Array<Record<string, unknown>> = [];
  const unsafe: string[] = [];
  let eligibleCorrect = 0;
  let safeMisses = 0;
  let blockedControlsPassed = 0;

  for (const fixture of PHASE_E_REAL_DERIVED_FIXTURES) {
    const result = runPurchaseIdentityShadow({
      userId: USER_ID,
      document: buildEmailDocumentV1(emailFor(fixture)),
      snapshot: snapshotFor(fixture.snapshotKey),
      merchantResolver,
      carrierResolver,
    });

    assert.equal(result.productionWrites, 0, `${fixture.id}: shadow production write invariant`);
    assert.equal(result.aiCalls, 0, `${fixture.id}: AI invariant`);
    assert.equal(result.promotionReadiness.productionWrites, 0, `${fixture.id}: promotion gate write invariant`);
    assert.equal(result.promotionReadiness.mode, 'audit_only', `${fixture.id}: promotion mode invariant`);

    const decision = result.decision?.kind ?? null;
    const eventType = result.canonicalEvent?.eventType ?? null;
    const promotion = result.promotionReadiness;

    if (fixture.expectation.kind === 'blocked') {
      if (promotion.eligible) {
        unsafe.push(`${fixture.id}: blocked real-derived control became ${promotion.action ?? 'eligible'}`);
      } else {
        blockedControlsPassed += 1;
      }
    } else if (fixture.expectation.kind === 'eligible_create_purchase') {
      if (!promotion.eligible) {
        safeMisses += 1;
      } else if (promotion.action !== 'CREATE_PURCHASE' || decision !== 'NEW_PURCHASE') {
        unsafe.push(`${fixture.id}: eligible create expectation produced ${promotion.action ?? 'null'} / ${decision ?? 'null'}`);
      } else {
        const expectedOrder = normalizeStableIdentifier(fixture.expectation.expectedOrderId);
        const created = result.simulatedSnapshot.orders.some((order) =>
          normalizeStableIdentifier(order.orderId) === expectedOrder
        );
        if (!created) unsafe.push(`${fixture.id}: eligible create lacked expected order identity`);
        else eligibleCorrect += 1;
      }
    } else {
      if (!promotion.eligible) {
        safeMisses += 1;
      } else if (promotion.action !== 'LINK_EVENT' || decision !== 'LINKED') {
        unsafe.push(`${fixture.id}: eligible link expectation produced ${promotion.action ?? 'null'} / ${decision ?? 'null'}`);
      } else if (result.decision?.kind !== 'LINKED' || result.decision.purchaseId !== fixture.expectation.expectedPurchaseId) {
        unsafe.push(`${fixture.id}: eligible link targeted the wrong Purchase`);
      } else {
        eligibleCorrect += 1;
      }
    }

    observations.push({
      id: fixture.id,
      sourceClass: fixture.sourceClass,
      eventType,
      decision,
      promotionEligible: promotion.eligible,
      promotionAction: promotion.action,
      promotionReasons: promotion.reasons,
    });
  }

  console.log('PHASE_E_REAL_DERIVED_FIRST_SCORE', JSON.stringify({
    fixtures: PHASE_E_REAL_DERIVED_FIXTURES.length,
    eligibleCorrect,
    safeMisses,
    blockedControlsPassed,
    unsafe,
    observations,
  }));

  assert.deepEqual(unsafe, []);
});
