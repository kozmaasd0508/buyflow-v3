import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { evaluatePurchaseCreationAuthority, hasExplicitPurchaseNonAcceptance } from './purchase-creation-authority.js';

function document(body: string, subject = 'Megrendelés visszaigazolása #AB-778812') {
  const email: NormalizedEmail = {
    provider: 'ses',
    providerMessageId: 'creation-authority-test',
    subject,
    from: [{ email: 'orders@never-seen-shop.hu', name: 'Never Seen Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T20:00:00.000Z',
    bodyHtml: `<div>${body}</div>`,
    folders: ['inbound'],
    attachments: [],
  };
  return buildEmailDocumentV1(email);
}

const richStructure = `
  <p>Köszönjük a rendelésed.</p>
  <p>Rendelés #AB-778812</p>
  <p>1x Teszt termék</p>
  <p>Végösszeg: 12 990 Ft</p>
  <p>Fizetési mód: utánvét</p>
  <p>Szállítási mód: futár</p>
`;

test('rich unknown merchant confirmation receives creation authority when no contradiction exists', () => {
  const doc = document(richStructure);
  const result = evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'authorized');
});

test('Hungarian automatic acknowledgement that denies contract formation is REVIEW', () => {
  const doc = document(`${richStructure}<p>Ez egy automata visszaigazolás a megrendelés leadásáról, nem jelenti a szerződés létrejöttét.</p>`);
  assert.equal(hasExplicitPurchaseNonAcceptance(doc), true);
  const result = evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'review');
  assert.ok(result.reasons.includes('explicit_order_non_acceptance_or_contract_disclaimer'));
});

test('Hungarian message explicitly saying it is not the order confirmation is REVIEW', () => {
  const doc = document(`
    ${richStructure}
    <p>Ez az e-mail nem minősül a megrendelés visszaigazolásának.</p>
    <p>Megrendelésed tényleges visszaigazolása egy későbbi e-mailben fog érkezni.</p>
  `, 'Rendelés beérkezett #AB-778812');
  assert.equal(hasExplicitPurchaseNonAcceptance(doc), true);
  const result = evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'review');
});

test('Hungarian purchase-offer receipt acknowledgement is REVIEW', () => {
  const doc = document(`
    ${richStructure}
    <p>Ez az üzenet csupán a vételi ajánlat megérkezéséről értesítünk.</p>
  `, 'Rendelési értesítés #AB-778812');
  assert.equal(hasExplicitPurchaseNonAcceptance(doc), true);
  const result = evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'review');
});

test('later explicit merchant acceptance remains authorized', () => {
  const doc = document(`
    ${richStructure}
    <p>Örömmel értesítünk, hogy megrendelésedet elfogadtuk és megkezdtük az összekészítését.</p>
  `, 'Megrendelésedet elfogadtuk #AB-778812');
  assert.equal(hasExplicitPurchaseNonAcceptance(doc), false);
  const result = evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'authorized');
});

test('English order acknowledgement without acceptance is REVIEW', () => {
  const doc = document(`${richStructure}<p>This acknowledgement does not constitute a contract and your order has not yet been accepted.</p>`, 'Order received #AB-778812');
  const result = evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  });
  assert.equal(result.authority, 'review');
});

test('missing hard order id or non-merchant source cannot authorize Purchase creation', () => {
  const doc = document(richStructure);
  assert.equal(evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'merchant',
    orderId: null,
  }).authority, 'review');
  assert.equal(evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'order_created',
    sourceRole: 'carrier',
    orderId: 'AB-778812',
  }).authority, 'review');
});

test('lifecycle event never receives new Purchase creation authority', () => {
  const doc = document(richStructure);
  assert.equal(evaluatePurchaseCreationAuthority({
    document: doc,
    eventType: 'shipment_created',
    sourceRole: 'merchant',
    orderId: 'AB-778812',
  }).authority, 'none');
});
