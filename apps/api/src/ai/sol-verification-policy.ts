import type { EmailExtraction } from './openai-email-extractor.js';

export const BUYFLOW_SOL_VERIFIER_MODEL = 'gpt-5.6-sol' as const;

export type SolVerificationReason =
  | 'evidence_issue'
  | 'low_confidence'
  | 'order_update_boundary'
  | 'shipment_phase_missing'
  | 'merchant_pre_handover_boundary'
  | 'ambiguous_order_creation'
  | 'receipt_missing_order_link';

export interface SolVerificationDecision {
  verify: boolean;
  reasons: SolVerificationReason[];
}

/**
 * Luna remains the cheap first-pass extractor. Sol is reserved for semantic
 * boundaries where the REAL30 holdout showed Luna can be over-confident.
 *
 * The policy intentionally avoids sender/shop-specific names and IDs so it
 * generalizes beyond the tuning mailbox.
 */
export function decideSolVerification(extraction: EmailExtraction): SolVerificationDecision {
  const reasons: SolVerificationReason[] = [];

  if ((extraction.evidence_issues?.length ?? 0) > 0) {
    reasons.push('evidence_issue');
  }

  if (extraction.confidence < 0.9) {
    reasons.push('low_confidence');
  }

  if (extraction.event_type === 'order_updated') {
    reasons.push('order_update_boundary');
  }

  if (extraction.event_type === 'shipment' && !extraction.shipment_phase) {
    reasons.push('shipment_phase_missing');
  }

  if (
    extraction.event_type === 'shipment'
    && extraction.shipment_phase === 'shipment_created'
    && Boolean(extraction.order_number)
    && Boolean(extraction.tracking_number)
  ) {
    reasons.push('merchant_pre_handover_boundary');
  }

  if (extraction.event_type === 'order_created' && extraction.confidence < 0.99) {
    reasons.push('ambiguous_order_creation');
  }

  if (
    extraction.event_type === 'invoice_or_receipt'
    && Boolean(extraction.invoice_number)
    && !extraction.order_number
  ) {
    reasons.push('receipt_missing_order_link');
  }

  return { verify: reasons.length > 0, reasons: [...new Set(reasons)] };
}

export function extractionsAgreeOnCoreIdentity(a: EmailExtraction, b: EmailExtraction): boolean {
  return (
    a.event_type === b.event_type
    && (a.shipment_phase ?? null) === (b.shipment_phase ?? null)
    && a.order_number === b.order_number
    && a.tracking_number === b.tracking_number
    && a.invoice_number === b.invoice_number
    && a.payment_status === b.payment_status
  );
}
