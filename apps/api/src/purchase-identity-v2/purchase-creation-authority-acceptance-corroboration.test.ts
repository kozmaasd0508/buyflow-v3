import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import {
  evaluatePurchaseCreationAuthority,
  hasExplicitPurchaseAcceptance,
} from './purchase-creation-authority.js';

function document(body: string, subject = 'Rendelési értesítés #AB-778812') {
  const email: NormalizedEmail = {
    provider: 'ses',
    providerMessageId: 'acceptance-corroboration-test',
    subject,
    from: [{ email: 'orders@never-seen-shop.hu', name: 'Never Seen Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-26T20:00:00.000Z',
    bodyHtml: `<div>${body}</div>`,
    folders: ['inbound'],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

function authority(body: string, subject?: string, sourceRole: 'merchant' | 'carrier' | 'unknown' = 'merchant') {
  return evaluatePurchaseCreationAuthority({
    document: document(body, subject),
    eventType: 'order_created',
    sourceRole,
    orderId: 'AB-778812',
  });
}

test('explicit Hungarian order acceptance plus one concrete amount authorizes creation', () => {
  const doc = document(`
    <p>Megrendelés #AB-778812</p>
    <p>Végösszeg: 12 990 Ft</p>
    <p>Megrendelésedet elfogadtuk.</p>
  `);
  assert.equal(hasExplicitPurchaseAcceptance(doc), true);
  assert.equal(evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  }).authority, 'authorized');
});

test('explicit order-confirmation subject plus one concrete amount authorizes creation', () => {
  const result = authority(`
    <p>Rendelés #AB-778812</p>
    <p>Végösszeg: 12 990 Ft</p>
  `, 'Megrendelés visszaigazolása #AB-778812');
  assert.equal(result.authority, 'authorized');
});

test('English confirmed order plus one concrete amount authorizes creation', () => {
  const result = authority(`
    <p>Order AB-778812</p>
    <p>Total: 49.90 EUR</p>
    <p>Your order has been confirmed.</p>
  `, 'Your order is confirmed');
  assert.equal(result.authority, 'authorized');
});

test('merchant plus order id and acceptance language without a concrete commerce signal remains REVIEW', () => {
  const result = authority(`
    <p>Order AB-778812</p>
    <p>Your order has been confirmed.</p>
  `, 'Order confirmed');
  assert.equal(result.authority, 'review');
  assert.deepEqual(result.reasons, ['insufficient_independent_commerce_structure']);
});

test('one amount without explicit acceptance or another independent structure remains REVIEW', () => {
  const result = authority(`
    <p>Rendelés #AB-778812</p>
    <p>Végösszeg: 12 990 Ft</p>
  `, 'Rendelési értesítés #AB-778812');
  assert.equal(result.authority, 'review');
});

test('explicit non-acceptance overrides confirmation-looking language', () => {
  const result = authority(`
    <p>Rendelés #AB-778812</p>
    <p>Végösszeg: 12 990 Ft</p>
    <p>Megrendelés visszaigazolása</p>
    <p>Ez az automatikus visszaigazolás nem jelenti a szerződés létrejöttét.</p>
  `, 'Megrendelés visszaigazolása #AB-778812');
  assert.equal(result.authority, 'review');
  assert.deepEqual(result.reasons, ['explicit_order_non_acceptance_or_contract_disclaimer']);
});

test('unknown or carrier source cannot use acceptance corroboration to create a Purchase', () => {
  const body = `
    <p>Rendelés #AB-778812</p>
    <p>Végösszeg: 12 990 Ft</p>
    <p>Megrendelésedet elfogadtuk.</p>
  `;
  assert.equal(authority(body, undefined, 'unknown').authority, 'review');
  assert.equal(authority(body, undefined, 'carrier').authority, 'review');
});
