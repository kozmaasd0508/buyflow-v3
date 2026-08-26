import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import type { NormalizedEmail } from '../email/types.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import {
  PHASE_E_REAL_FIDELITY_FIXTURES,
  type PhaseERealFidelityFixture,
} from './phase-e-real-fidelity-fixtures.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from './types.js';

const USER_ID = 'phase-e-real-fidelity-user';

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function gateOrderSnapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [{
      purchaseId: 'p-gate',
      userId: USER_ID,
      canonicalMerchantId: 'merchant:gate',
      primaryOrderIdentityId: 'o-gate',
      state: 'open',
    }],
    orders: [{
      orderIdentityId: 'o-gate',
      purchaseId: 'p-gate',
      merchantId: 'merchant:gate',
      merchantNamespace: 'gate.shop',
      orderId: '90427163',
      relation: 'primary',
      parentOrderIdentityId: null,
    }],
    shipments: [],
    payments: [],
    invoices: [],
  };
}

function snapshotFor(key: PhaseERealFidelityFixture['snapshotKey']): PurchaseIdentitySnapshot {
  return key === 'gate-order' ? gateOrderSnapshot() : emptySnapshot();
}

function emailFor(fixture: PhaseERealFidelityFixture): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `phase-e-real-fidelity-${fixture.id}`,
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
    if (domain === 'gate.shop' && raw.includes('gate')) return 'merchant:gate';
    return null;
  },
};

const carrierResolver = {
  resolve(input: { carrierRaw: string }) {
    const value = input.carrierRaw.trim().toLowerCase();
    if (value.includes('foxpost')) return 'foxpost';
    if (value.includes('packeta')) return 'packeta';
    if (value.includes('express one')) return 'express-one';
    return value || null;
  },
};

test('Phase E post-fix fidelity replay remains precision-first', () => {
  const observations: Array<Record<string, unknown>> = [];
  const unsafe: string[] = [];
  let eligibleCorrect = 0;
  let safeMisses = 0;
  let blockedControlsPassed = 0;

  for (const fixture of PHASE_E_REAL_FIDELITY_FIXTURES) {
    const result = runPurchaseIdentityShadow({
      userId: USER_ID,
      document: buildEmailDocumentV1(emailFor(fixture)),
      snapshot: snapshotFor(fixture.snapshotKey),
      merchantResolver,
      carrierResolver,
    });

    assert.equal(result.productionWrites, 0, `${fixture.id}: shadow production write invariant`);
    assert.equal(result.aiCalls, 0, `${fixture.id}: AI invariant`);
    assert.equal(result.promotionReadiness.productionWrites, 0, `${fixture.id}: promotion write invariant`);
    assert.equal(result.promotionReadiness.mode, 'audit_only', `${fixture.id}: audit-only invariant`);

    const decision = result.decision?.kind ?? null;
    const eventType = result.canonicalEvent?.eventType ?? null;
    const promotion = result.promotionReadiness;

    if (fixture.expectation.kind === 'blocked') {
      if (promotion.eligible) unsafe.push(`${fixture.id}: blocked control became ${promotion.action ?? 'eligible'}`);
      else blockedControlsPassed += 1;
    } else if (fixture.expectation.kind === 'eligible_create_purchase') {
      if (!promotion.eligible) {
        safeMisses += 1;
      } else if (promotion.action !== 'CREATE_PURCHASE' || decision !== 'NEW_PURCHASE') {
        unsafe.push(`${fixture.id}: expected CREATE_PURCHASE, got ${promotion.action ?? 'null'} / ${decision ?? 'null'}`);
      } else {
        const expectedOrder = normalizeStableIdentifier(fixture.expectation.expectedOrderId);
        const created = result.simulatedSnapshot.orders.some((order) => normalizeStableIdentifier(order.orderId) === expectedOrder);
        if (!created) unsafe.push(`${fixture.id}: expected order identity was not created`);
        else eligibleCorrect += 1;
      }
    } else {
      if (!promotion.eligible) {
        safeMisses += 1;
      } else if (promotion.action !== 'LINK_EVENT' || decision !== 'LINKED') {
        unsafe.push(`${fixture.id}: expected LINK_EVENT, got ${promotion.action ?? 'null'} / ${decision ?? 'null'}`);
      } else if (result.decision?.kind !== 'LINKED' || result.decision.purchaseId !== fixture.expectation.expectedPurchaseId) {
        unsafe.push(`${fixture.id}: eligible link targeted wrong Purchase`);
      } else {
        eligibleCorrect += 1;
      }
    }

    observations.push({
      id: fixture.id,
      eventType,
      decision,
      promotionEligible: promotion.eligible,
      promotionAction: promotion.action,
      promotionReasons: promotion.reasons,
    });
  }

  console.log('PHASE_E_REAL_FIDELITY_POST_FIX_SCORE', JSON.stringify({
    fixtures: PHASE_E_REAL_FIDELITY_FIXTURES.length,
    eligibleCorrect,
    safeMisses,
    blockedControlsPassed,
    unsafe,
    observations,
  }));

  assert.deepEqual(unsafe, []);
});
