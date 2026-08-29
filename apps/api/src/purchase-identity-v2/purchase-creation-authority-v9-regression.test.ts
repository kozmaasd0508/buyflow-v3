import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import {
  evaluatePurchaseCreationAuthority,
  hasExplicitPurchaseRootEvidence,
} from './purchase-creation-authority.js';

function doc(subject: string, body: string) {
  const email: NormalizedEmail = {
    provider: 'ses',
    providerMessageId: crypto.randomUUID(),
    subject,
    from: [{ email: 'orders@merchant-owned.example', name: 'Merchant Owned' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-29T18:00:00.000Z',
    snippet: body,
    folders: ['inbound'],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

test('explicit received order plus hard id and one payment structure signal can authorize', () => {
  const document = doc(
    'Rendelésed megkaptuk',
    'Köszönjük a rendelést. Rendelésed megkaptuk és feldolgozás alatt van. Rendelés száma: BF-778812. Fizetési mód: utánvét.',
  );
  const result = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_updated',
    sourceRole: 'merchant',
    orderId: 'BF-778812',
  });
  assert.equal(result.authority, 'authorized');
  assert.ok(result.reasons.includes('independent_commerce_structure'));
});

test('structure-free order receipt remains REVIEW even with merchant source and hard id', () => {
  const document = doc(
    'Rendelés visszaigazolás',
    'Rendelését rendben átvettük. Rendelés azonosító: BF-778812.',
  );
  assert.equal(hasExplicitPurchaseRootEvidence(document), true);
  const result = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'BF-778812',
  });
  assert.equal(result.authority, 'review');
  assert.ok(result.reasons.includes('insufficient_independent_commerce_structure'));
});

test('received order-request wording is recognized as root evidence but stays REVIEW without structure', () => {
  const document = doc(
    'Rendelési igény visszaigazolás',
    'Beérkezett hozzánk a rendelési/foglalási igénye. Rendelés azonosító: BF-778812.',
  );
  assert.equal(hasExplicitPurchaseRootEvidence(document), true);
  assert.equal(evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'BF-778812',
  }).authority, 'review');
});

test('explicit non-acceptance still blocks a one-structure root', () => {
  const document = doc(
    'Rendelés beérkezett',
    'Rendelésed megkaptuk. Rendelés száma: BF-778812. Fizetési mód: bankkártya. Ez az e-mail nem minősül a megrendelés visszaigazolásának.',
  );
  const result = evaluatePurchaseCreationAuthority({
    document,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'BF-778812',
  });
  assert.equal(result.authority, 'review');
  assert.ok(result.reasons.includes('explicit_order_non_acceptance_or_contract_disclaimer'));
});
