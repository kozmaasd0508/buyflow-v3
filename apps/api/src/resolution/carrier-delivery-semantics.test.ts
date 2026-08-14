import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCarrierBridgeEventType } from './tracking-bridge-resolution.js';

test('carrier arriving-today wording is not treated as final delivery', () => {
  assert.equal(normalizeCarrierBridgeEventType('Csomag kézbesítés ma – ETA és módosítás', 'delivery'), 'shipment');
  assert.equal(normalizeCarrierBridgeEventType('Értesítés 16380124260518 MODELL&HOBBY Kft. küldemény mai kézbesítéséről', 'delivery'), 'shipment');
});

test('explicit delivered wording remains final delivery', () => {
  assert.equal(normalizeCarrierBridgeEventType('Küldemény kézbesítve – kérdőív', 'delivery'), 'delivery');
  assert.equal(normalizeCarrierBridgeEventType('Értesítés 16380124260518 sikeres kézbesítéséről', 'delivery'), 'delivery');
  assert.equal(normalizeCarrierBridgeEventType('Your parcel has been delivered', 'delivery'), 'delivery');
});

test('shipment extraction is never promoted to delivery by subject wording', () => {
  assert.equal(normalizeCarrierBridgeEventType('Küldemény kézbesítve – kérdőív', 'shipment'), 'shipment');
});
