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

const USER_ID = 'phase-e-real-structure-fidelity-user';

const STRUCTURE_FIDELITY_FIXTURES: PhaseERealFidelityFixture[] = PHASE_E_REAL_FIDELITY_FIXTURES.map((fixture) => {
  if (fixture.id !== 'rf-13-gate-order-confirmed') return fixture;
  return {
    ...fixture,
    body: [
      'gate.shop',
      'Jó napot kívánunk!',
      'köszönjük, hogy a gate.shop-nál vásárolt. 90427163 számú megrendelését fogadtuk és küldésekor felvesszük Önnel a kapcsolatot.',
      'Az alábbiakban megtekintheti vásárlásának részleteit.',
      'rendelés részlete',
      'rendelés száma',
      '90427163',
      'rendelés dátuma',
      '28. 07. 2026, 14:18',
      'fizetés',
      'Utánvéttel',
      'kézbesítés',
      'FoxPost box / Packeta box',
      'megnevezés',
      'méret',
      'mennyiség',
      'darabár',
      'ár összesen',
      'Teszt termék Alpha',
      'SKU-TEST-ALPHA',
      'M',
      '1 db',
      '1 815,00 HUF',
      '1 815,00 HUF',
      'Teszt termék Beta',
      'SKU-TEST-BETA',
      'L',
      '2 db',
      '2 000,00 HUF',
      '4 000,00 HUF',
      'szállítás',
      '890,00 HUF',
      'fizetés',
      '990,00 HUF',
      'összesen',
      '12 535,00 HUF',
    ].join('\n'),
  };
});

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function gateOrderSnapshot(): PurchaseIdentitySnapshot {
  return {
    purchases: [{ purchaseId: 'p-gate', userId: USER_ID, canonicalMerchantId: 'merchant:gate', primaryOrderIdentityId: 'o-gate', state: 'open' }],
    orders: [{ orderIdentityId: 'o-gate', purchaseId: 'p-gate', merchantId: 'merchant:gate', merchantNamespace: 'gate.shop', orderId: '90427163', relation: 'primary', parentOrderIdentityId: null }],
    shipments: [], payments: [], invoices: [],
  };
}

function snapshotFor(key: PhaseERealFidelityFixture['snapshotKey']): PurchaseIdentitySnapshot {
  return key === 'gate-order' ? gateOrderSnapshot() : emptySnapshot();
}

function emailFor(fixture: PhaseERealFidelityFixture): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `phase-e-real-structure-fidelity-${fixture.id}`,
    subject: fixture.subject,
    from: [{ email: fixture.senderEmail, name: fixture.senderName }],
    to: [{ email: 'buyer@example.net', name: 'Buyer' }],
    cc: [], bcc: [],
    receivedAt: '2026-07-31T12:00:00.000Z',
    snippet: fixture.body,
    headers: [], folders: ['inbox'], attachments: [],
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

test('Phase E structure-fidelity post-fix replay exercises both safe positive paths', () => {
  const unsafe: string[] = [];
  const observations: Array<Record<string, unknown>> = [];
  let eligibleCorrect = 0;
  let safeMisses = 0;
  let blockedControlsPassed = 0;

  for (const fixture of STRUCTURE_FIDELITY_FIXTURES) {
    const document = buildEmailDocumentV1(emailFor(fixture));
    const result = runPurchaseIdentityShadow({
      userId: USER_ID,
      document,
      snapshot: snapshotFor(fixture.snapshotKey),
      merchantResolver,
      carrierResolver,
    });

    assert.equal(result.productionWrites, 0);
    assert.equal(result.aiCalls, 0);
    assert.equal(result.promotionReadiness.productionWrites, 0);
    assert.equal(result.promotionReadiness.mode, 'audit_only');

    const decision = result.decision?.kind ?? null;
    const promotion = result.promotionReadiness;

    if (fixture.expectation.kind === 'blocked') {
      if (promotion.eligible) unsafe.push(`${fixture.id}: blocked control became eligible`);
      else blockedControlsPassed += 1;
    } else if (fixture.expectation.kind === 'eligible_create_purchase') {
      if (!promotion.eligible) safeMisses += 1;
      else if (promotion.action !== 'CREATE_PURCHASE' || decision !== 'NEW_PURCHASE') unsafe.push(`${fixture.id}: wrong create result`);
      else {
        const expectedOrder = normalizeStableIdentifier(fixture.expectation.expectedOrderId);
        const created = result.simulatedSnapshot.orders.some((order) => normalizeStableIdentifier(order.orderId) === expectedOrder);
        if (!created) unsafe.push(`${fixture.id}: expected order identity missing`);
        else eligibleCorrect += 1;
      }
    } else {
      if (!promotion.eligible) safeMisses += 1;
      else if (promotion.action !== 'LINK_EVENT' || result.decision?.kind !== 'LINKED' || result.decision.purchaseId !== fixture.expectation.expectedPurchaseId) unsafe.push(`${fixture.id}: wrong link result`);
      else eligibleCorrect += 1;
    }

    observations.push({
      id: fixture.id,
      eventType: result.canonicalEvent?.eventType ?? null,
      sourceRole: result.canonicalEvent?.sourceRole ?? null,
      decision,
      creationAuthority: result.canonicalEvent?.purchaseCreationAuthority ?? null,
      creationReasons: result.canonicalEvent?.purchaseCreationReasons ?? [],
      structureSignals: {
        orderSummarySections: document.sections.filter((section) => section.type === 'order_summary').length,
        products: document.signals.products.length,
        amounts: document.signals.amounts.length,
        paymentMethods: document.signals.paymentMethods.length,
        shippingMethods: document.signals.shippingMethods.length,
      },
      promotionEligible: promotion.eligible,
      promotionAction: promotion.action,
      promotionReasons: promotion.reasons,
    });
  }

  console.log('PHASE_E_REAL_STRUCTURE_FIDELITY_POST_FIX_SCORE', JSON.stringify({
    fixtures: STRUCTURE_FIDELITY_FIXTURES.length,
    eligibleCorrect,
    safeMisses,
    blockedControlsPassed,
    unsafe,
    observations,
  }));

  assert.deepEqual(unsafe, []);
});
