import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_CORE_PURCHASE_WRITES_ENABLED,
  canAutomaticallyWriteDocument,
  canAutomaticallyWritePurchase,
  canAutomaticallyWriteShipment,
  isShadowOnlyParserVersion,
  isTrustedAutomaticEvidence,
} from './automatic-write-gate.js';
import type { DocumentResolutionCandidate } from '../resolution/document-resolution.js';
import type { PurchaseResolutionCandidate } from '../resolution/purchase-resolution.js';
import type { ShipmentResolutionCandidate } from '../resolution/shipment-resolution.js';

function purchase(overrides: Partial<PurchaseResolutionCandidate> = {}): PurchaseResolutionCandidate {
  return {
    key: 'user::merchant::order', userId: 'user-1', senderDomain: 'shop.example', merchant: 'Example Shop',
    orderNumber: 'ORDER-1', decision: 'create_corroborated', confidence: 0.94, evidenceCount: 3,
    orderCreatedEvidenceCount: 1, corroboratingEvidenceCount: 2, reasons: [],
    sourceEmailIds: ['email-1', 'email-2', 'email-3'], ...overrides,
  };
}

function shipment(overrides: Partial<ShipmentResolutionCandidate> = {}): ShipmentResolutionCandidate {
  return {
    key: 'user::tracking', userId: 'user-1', trackingNumber: 'TRACK123', carrierSlug: 'express-one',
    purchaseId: 'purchase-1', decision: 'linkable', recommendedStatus: 'delivered', confidence: 0.94,
    evidenceCount: 3, merchantAnchorCount: 1, carrierEvidenceCount: 2, physicalShipmentEvidenceCount: 1,
    reasons: [], sourceEmailIds: ['email-1', 'email-2', 'email-3'], ...overrides,
  };
}

function document(overrides: Partial<DocumentResolutionCandidate> = {}): DocumentResolutionCandidate {
  return {
    sourceEmailId: 'email-1', userId: 'user-1', purchaseId: 'purchase-1', decision: 'linkable',
    documentType: 'invoice', confidence: 0.9, reasons: [], ...overrides,
  };
}

test('validated and guardrailed evidence are trusted, review evidence is not', () => {
  assert.equal(isTrustedAutomaticEvidence('validated', null), true);
  assert.equal(isTrustedAutomaticEvidence('guardrailed', null), true);
  assert.equal(isTrustedAutomaticEvidence('review', null), false);
  assert.equal(isTrustedAutomaticEvidence('validated', { validation_status: 'review' }), false);
});

test('generic order confirmation parser versions are permanently shadow-only at the write gate', () => {
  assert.equal(isShadowOnlyParserVersion('generic-order-confirmation-v1.2'), true);
  assert.equal(isShadowOnlyParserVersion('generic-order-confirmation-v2.0'), true);
  assert.equal(isShadowOnlyParserVersion('jatekbolt-order-received-v1'), false);
  assert.equal(isShadowOnlyParserVersion('deterministic-commerce-v2'), false);

  assert.equal(isTrustedAutomaticEvidence('validated', {
    validation_status: 'validated',
    parser_version: 'generic-order-confirmation-v1.2',
  }), false);
  assert.equal(isTrustedAutomaticEvidence('guardrailed', {
    validation_status: 'guardrailed',
    parser_version: 'generic-order-confirmation-v2.0',
  }), false);
  assert.equal(isTrustedAutomaticEvidence('validated', {
    validation_status: 'validated',
    parser_version: 'jatekbolt-order-received-v1',
  }), true);
});

test('legacy Core Purchase creation remains disabled even for formerly strong candidates', () => {
  assert.equal(LEGACY_CORE_PURCHASE_WRITES_ENABLED, false);
  assert.equal(canAutomaticallyWritePurchase(purchase()), false);
  assert.equal(canAutomaticallyWritePurchase(purchase({
    decision: 'create_direct', confidence: 0.99, evidenceCount: 4,
    corroboratingEvidenceCount: 3,
  })), false);
});

test('legacy automatic payment evidence is fail-closed', () => {
  assert.equal(isTrustedAutomaticEvidence('validated', {
    validation_status: 'validated',
    event_type: 'payment_completed',
    parser_version: 'deterministic-commerce-v2',
  }), false);
});

test('never writes lifecycle-only purchase candidate', () => {
  assert.equal(canAutomaticallyWritePurchase(purchase({ decision: 'lifecycle_only' })), false);
});

test('keeps the separately controlled Shipment lane available', () => {
  assert.equal(canAutomaticallyWriteShipment(shipment()), true);
  assert.equal(canAutomaticallyWriteShipment(shipment({ carrierEvidenceCount: 1 })), false);
  assert.equal(canAutomaticallyWriteShipment(shipment({ merchantAnchorCount: 0 })), false);
  assert.equal(canAutomaticallyWriteShipment(shipment({
    recommendedStatus: 'shipment_created', physicalShipmentEvidenceCount: 0,
  })), false);
  assert.equal(canAutomaticallyWriteShipment(shipment({ physicalShipmentEvidenceCount: 0 })), false);
});

test('keeps the separately controlled invoice document lane available', () => {
  assert.equal(canAutomaticallyWriteDocument(document()), true);
  assert.equal(canAutomaticallyWriteDocument(document({ documentType: 'receipt' })), false);
  assert.equal(canAutomaticallyWriteDocument(document({ confidence: 0.84 })), false);
});
