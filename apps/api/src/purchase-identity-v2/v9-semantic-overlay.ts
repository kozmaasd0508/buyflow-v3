import type { SemanticEventOverride } from './extraction-v2-adapter.js';
import type { CanonicalEventType } from './types.js';

export const V9_SEMANTIC_OVERLAY_VERSION = 'v9-semantic-overlay-v1' as const;

export const V9_EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_PROCESSING',
  'ORDER_PACKING',
  'SHIPMENT_CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'DELIVERY_FAILED',
  'DELAYED',
  'CANCELLED',
  'REFUNDED',
  'PAYMENT',
  'INVOICE',
  'RETURN',
  'WARRANTY',
  'OTHER',
] as const;

export type V9SemanticEventType = typeof V9_EVENT_TYPES[number];

export interface V9SemanticPrediction {
  eventType: string;
  isCommerce: boolean;
}

export type V9SemanticOverlayResult =
  | {
      ok: true;
      eventType: V9SemanticEventType;
      override: SemanticEventOverride;
    }
  | {
      ok: false;
      reason: 'INVALID_EVENT_TYPE' | 'COMMERCE_INVARIANT_MISMATCH';
    };

const VALID = new Set<string>(V9_EVENT_TYPES);

/**
 * Coarse mapping for the Identity Graph only. The full V9 label remains in
 * provenance and may be used by a separate lifecycle/UI state projector.
 *
 * Several detailed shipment labels intentionally collapse to shipment_created:
 * Identity Graph v2 needs a shipment identity and hard correlation keys, not a
 * second copy of the full lifecycle state machine.
 */
export function canonicalIdentityEventTypeFromV9(eventType: V9SemanticEventType): CanonicalEventType {
  switch (eventType) {
    case 'ORDER_CREATED':
      return 'order_created';
    case 'ORDER_PROCESSING':
    case 'ORDER_PACKING':
      return 'order_updated';
    case 'SHIPMENT_CREATED':
    case 'SHIPPED':
    case 'IN_TRANSIT':
    case 'READY_FOR_PICKUP':
    case 'DELIVERY_FAILED':
    case 'DELAYED':
      return 'shipment_created';
    case 'OUT_FOR_DELIVERY':
      return 'out_for_delivery';
    case 'DELIVERED':
      return 'delivered';
    case 'PAYMENT':
      return 'payment_completed';
    case 'INVOICE':
      return 'invoice_created';
    case 'REFUNDED':
      return 'refund_completed';
    case 'RETURN':
      return 'return_created';
    case 'CANCELLED':
      return 'cancelled';
    case 'WARRANTY':
    case 'OTHER':
      return 'other';
  }
}

/**
 * Strict fail-closed adapter from the V9 classifier schema to a semantic-only
 * event override. No identity values are accepted or returned by this API.
 */
export function semanticEventOverrideFromV9(prediction: V9SemanticPrediction): V9SemanticOverlayResult {
  const raw = String(prediction.eventType ?? '').trim().toUpperCase();
  if (!VALID.has(raw)) return { ok: false, reason: 'INVALID_EVENT_TYPE' };

  const eventType = raw as V9SemanticEventType;
  const expectedCommerce = eventType !== 'OTHER';
  if (prediction.isCommerce !== expectedCommerce) {
    return { ok: false, reason: 'COMMERCE_INVARIANT_MISMATCH' };
  }

  return {
    ok: true,
    eventType,
    override: {
      eventType: canonicalIdentityEventTypeFromV9(eventType),
      semanticLabel: eventType,
      sourceId: 'qwen3-8b-buyflow-v9',
      sourceVersion: V9_SEMANTIC_OVERLAY_VERSION,
    },
  };
}
