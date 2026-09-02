import type { SemanticEventOverride } from './extraction-v2-adapter.js';
import type { CanonicalEventType } from './types.js';

export const SEMANTIC_EVENT_TYPES = [
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

export type SemanticEventType = typeof SEMANTIC_EVENT_TYPES[number];

export interface SemanticPrediction {
  eventType: string;
  isCommerce: boolean;
}

export interface SemanticOverlaySource {
  sourceId: string;
  sourceVersion: string;
}

export type SemanticOverlayResult =
  | {
      ok: true;
      eventType: SemanticEventType;
      override: SemanticEventOverride;
    }
  | {
      ok: false;
      reason: 'INVALID_EVENT_TYPE' | 'COMMERCE_INVARIANT_MISMATCH';
    };

const VALID = new Set<string>(SEMANTIC_EVENT_TYPES);

/**
 * Coarse mapping for the Identity Graph only. The full semantic label remains
 * in provenance and may be used by a separate lifecycle/UI state projector.
 *
 * Detailed shipment labels intentionally collapse to shipment_created because
 * the Identity Graph owns identity/correlation, not the full lifecycle state
 * machine.
 */
export function canonicalIdentityEventTypeFromSemanticEvent(
  eventType: SemanticEventType,
): CanonicalEventType {
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
 * Shared fail-closed adapter for semantic classifiers. The API intentionally
 * accepts only lifecycle semantics plus source provenance. Identity values are
 * neither accepted nor returned.
 */
export function semanticEventOverrideFromPrediction(
  prediction: SemanticPrediction,
  source: SemanticOverlaySource,
): SemanticOverlayResult {
  const raw = String(prediction.eventType ?? '').trim().toUpperCase();
  if (!VALID.has(raw)) return { ok: false, reason: 'INVALID_EVENT_TYPE' };

  const eventType = raw as SemanticEventType;
  const expectedCommerce = eventType !== 'OTHER';
  if (prediction.isCommerce !== expectedCommerce) {
    return { ok: false, reason: 'COMMERCE_INVARIANT_MISMATCH' };
  }

  return {
    ok: true,
    eventType,
    override: {
      eventType: canonicalIdentityEventTypeFromSemanticEvent(eventType),
      semanticLabel: eventType,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
    },
  };
}
