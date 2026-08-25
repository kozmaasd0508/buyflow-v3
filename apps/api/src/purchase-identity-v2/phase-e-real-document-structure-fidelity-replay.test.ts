import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmailDocumentV1, type EmailDocumentV1 } from '../ingestion/email-document.js';
import type { NormalizedEmail } from '../email/types.js';
import { normalizeStableIdentifier } from './identifier-normalizer.js';
import {
  PHASE_E_REAL_FIDELITY_FIXTURES,
  type PhaseERealFidelityFixture,
} from './phase-e-real-fidelity-fixtures.js';
import { runPurchaseIdentityShadow } from './shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from './types.js';

const USER_ID = 'phase-e-real-document-structure-user';

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
    providerMessageId: `phase-e-real-document-structure-${fixture.id}`,
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

/**
 * The original positive order-confirmation source contained an HTML order block
 * with multiple products, payment method, delivery method and a final total.
 * The mailbox source itself is private and is never committed. The synthetic
 * values below preserve only those observed structural categories so the replay
 * exercises the same EmailDocumentV1 authority boundary without retaining user
 * PII, real products or real transaction identifiers.
 */
function preserveObservedDocumentStructure(
  fixture: PhaseERealFidelityFixture,
  document: EmailDocumentV1,
): EmailDocumentV1 {
  if (fixture.id !== 'rf-13-gate-order-confirmed') return document;

  return {
    ...document,
    sections: [
      ...document.sections,
      { type: 'order_summary', text: 'privacy-safe observed order summary block' },
      { type: 'payment', text: 'privacy-safe observed payment method block' },
      { type: 'shipping', text: 'privacy-safe observed delivery method block' },
    ],
    signals: {
      ...document.signals,
      products: [
        { name: 'Synthetic Product Alpha', quantity: 1, raw: 'synthetic product row 1', unitPrice: 1815, totalPrice: 1815, currency: 'HUF' },
        { name: 'Synthetic Product Beta', quantity: 2, raw: 'synthetic product row 2', unitPrice: 2000, totalPrice: 4000, currency: 'HUF' },
      ],
      paymentMethods: ['cash_on_delivery'],
      shippingMethods: ['parcel_locker'],
    },
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

test('Phase E observed document-structure fidelity replay exercises both positive paths without unsafe promotion', () => {
  const unsafe: string[] = [];
  const observations: Array<Record<string, unknown>> = [];
  let eligibleCorrect = 0;
  let safeMisses = 0;
  let blockedControlsPassed = 0;

  for (const fixture of PHASE_E_REAL_FIDELITY_FIXTURES) {
    const baseDocument = buildEmailDocumentV1(emailFor(fixture));
    const document = preserveObservedDocumentStructure(fixture, baseDocument);
    const result = runPurchaseIdentityShadow({
      userId: USER_ID,
      document,
      snapshot: snapshotFor(fixture.snapshotKey),
      merchantResolver,
      carrierResolver,
    });

    assert.equal(result.productionWrites, 0, `${fixture.id}: shadow write invariant`);
    assert.equal(result.aiCalls, 0, `${fixture.id}: AI invariant`);
    assert.equal(result.promotionReadiness.productionWrites, 0, `${fixture.id}: promotion write invariant`);
    assert.equal(result.promotionReadiness.mode, 'audit_only', `${fixture.id}: promotion mode invariant`);

    const decision = result.decision?.kind ?? null;
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
        if (!created) unsafe.push(`${fixture.id}: expected order identity missing`);
        else eligibleCorrect += 1;
      }
    } else {
      if (!promotion.eligible) {
        safeMisses += 1;
      } else if (promotion.action !== 'LINK_EVENT' || result.decision?.kind !== 'LINKED' || result.decision.purchaseId !== fixture.expectation.expectedPurchaseId) {
        unsafe.push(`${fixture.id}: expected safe link to ${fixture.expectation.expectedPurchaseId}`);
      } else {
        eligibleCorrect += 1;
      }
    }

    observations.push({
      id: fixture.id,
      eventType: result.canonicalEvent?.eventType ?? null,
      decision,
      creationAuthority: result.canonicalEvent?.purchaseCreationAuthority ?? null,
      creationReasons: result.canonicalEvent?.purchaseCreationReasons ?? [],
      promotionEligible: promotion.eligible,
      promotionAction: promotion.action,
      promotionReasons: promotion.reasons,
    });
  }

  console.log('PHASE_E_REAL_DOCUMENT_STRUCTURE_FIDELITY_POST_FIX_SCORE', JSON.stringify({
    fixtures: PHASE_E_REAL_FIDELITY_FIXTURES.length,
    eligibleCorrect,
    safeMisses,
    blockedControlsPassed,
    unsafe,
    observations,
  }));

  assert.deepEqual(unsafe, []);
});
