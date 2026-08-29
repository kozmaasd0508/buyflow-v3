import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalIdentityEventTypeFromV9,
  semanticEventOverrideFromV9,
  type V9SemanticEventType,
} from './v9-semantic-overlay.js';
import type { CanonicalEventType } from './types.js';

const CASES: Array<[V9SemanticEventType, CanonicalEventType]> = [
  ['ORDER_CREATED', 'order_created'],
  ['ORDER_PROCESSING', 'order_updated'],
  ['ORDER_PACKING', 'order_updated'],
  ['SHIPMENT_CREATED', 'shipment_created'],
  ['SHIPPED', 'shipment_created'],
  ['IN_TRANSIT', 'shipment_created'],
  ['OUT_FOR_DELIVERY', 'out_for_delivery'],
  ['READY_FOR_PICKUP', 'shipment_created'],
  ['DELIVERED', 'delivered'],
  ['DELIVERY_FAILED', 'shipment_created'],
  ['DELAYED', 'shipment_created'],
  ['CANCELLED', 'cancelled'],
  ['REFUNDED', 'refund_completed'],
  ['PAYMENT', 'payment_completed'],
  ['INVOICE', 'invoice_created'],
  ['RETURN', 'return_created'],
  ['WARRANTY', 'other'],
  ['OTHER', 'other'],
];

test('maps all 18 V9 labels to the intentionally coarse Identity Graph taxonomy', () => {
  for (const [v9, canonical] of CASES) {
    assert.equal(canonicalIdentityEventTypeFromV9(v9), canonical, v9);
    const result = semanticEventOverrideFromV9({
      eventType: v9,
      isCommerce: v9 !== 'OTHER',
    });
    assert.equal(result.ok, true, v9);
    if (!result.ok) continue;
    assert.equal(result.eventType, v9);
    assert.equal(result.override.eventType, canonical);
    assert.equal(result.override.semanticLabel, v9);
    assert.equal(result.override.sourceId, 'qwen3-8b-buyflow-v9');
  }
});

test('rejects invented V9 labels instead of normalizing them into the graph', () => {
  assert.deepEqual(
    semanticEventOverrideFromV9({ eventType: 'PACKING_COMPLETE', isCommerce: true }),
    { ok: false, reason: 'INVALID_EVENT_TYPE' },
  );
});

test('rejects is_commerce mismatch fail-closed', () => {
  assert.deepEqual(
    semanticEventOverrideFromV9({ eventType: 'PAYMENT', isCommerce: false }),
    { ok: false, reason: 'COMMERCE_INVARIANT_MISMATCH' },
  );
  assert.deepEqual(
    semanticEventOverrideFromV9({ eventType: 'OTHER', isCommerce: true }),
    { ok: false, reason: 'COMMERCE_INVARIANT_MISMATCH' },
  );
});
