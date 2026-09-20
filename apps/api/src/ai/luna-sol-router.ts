import type { EmailExtraction } from '../ai/openai-email-extractor.js';

export type SolEscalationReason =
  | 'evidence_issue'
  | 'low_confidence'
  | 'order_semantics'
  | 'shipment_phase_missing'
  | 'merchant_pre_advice_boundary'
  | 'receipt_missing_order_link';

export interface SolEscalationDecision {
  escalate: boolean;
  reasons: SolEscalationReason[];
}

export function shouldEscalateLunaToSol(extraction: EmailExtraction): SolEscalationDecision {
  const reasons: SolEscalationReason[] = [];

  if ((extraction.evidence_issues?.length ?? 0) > 0) reasons.push('evidence_issue');
  if (extraction.confidence < 0.9) reasons.push('low_confidence');

  // Order creation/update mistakes are expensive and Luna can be overconfident,
  // so Sol verifies order-state semantics regardless of Luna confidence.
  if (extraction.event_type === 'order_created' || extraction.event_type === 'order_updated') {
    reasons.push('order_semantics');
  }

  // A shipment/delivery classification without a concrete phase is incomplete.
  if (
    (extraction.event_type === 'shipment' || extraction.event_type === 'delivery')
    && !extraction.shipment_phase
  ) {
    reasons.push('shipment_phase_missing');
  }

  // Merchant "packed / waiting for carrier" messages often contain both an
  // order id and a tracking-like id. Luna may promote these to shipment_created
  // even when the current event is still only an order update.
  if (
    extraction.event_type === 'shipment'
    && extraction.shipment_phase === 'shipment_created'
    && Boolean(extraction.order_number)
    && Boolean(extraction.tracking_number)
  ) {
    reasons.push('merchant_pre_advice_boundary');
  }

  // Receipts frequently carry a purchase/order reference that matters for
  // deterministic linking. If Luna misses it, ask Sol to recover it.
  if (
    extraction.event_type === 'invoice_or_receipt'
    && Boolean(extraction.invoice_number)
    && !extraction.order_number
  ) {
    reasons.push('receipt_missing_order_link');
  }

  return { escalate: reasons.length > 0, reasons };
}
