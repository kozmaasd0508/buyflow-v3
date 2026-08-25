import type { BuyFlowEmailEventType } from '../ai/openai-email-extractor.js';
import type { EmailDocumentV1 } from './email-document.js';
import {
  evaluateUniversalCommerceSemanticsV11,
  type UniversalCommerceSemanticsV11Result,
} from './universal-commerce-semantics-v1-1.js';

export const UNIVERSAL_COMMERCE_COMPOSITION_V1_1_VERSION = 'universal-commerce-composition-v1.1';

export type UniversalCompositionLifecycleV11 =
  | 'order_created'
  | 'order_processing'
  | 'order_cancelled'
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'invoice'
  | 'payment_completed'
  | 'payment_issue'
  | 'refund'
  | 'return'
  | 'unknown';

export type UniversalCompositionDecisionV11 = 'actionable' | 'review' | 'blocked';

export interface UniversalCommerceObservationV11 {
  version: typeof UNIVERSAL_COMMERCE_COMPOSITION_V1_1_VERSION;
  lifecycle: UniversalCompositionLifecycleV11;
  eventType: BuyFlowEmailEventType | null;
  decision: UniversalCompositionDecisionV11;
  confidence: number;
  evidence: string[];
  negativeEvidence: string[];
}

export interface UniversalCommerceCompositionV11Result {
  version: typeof UNIVERSAL_COMMERCE_COMPOSITION_V1_1_VERSION;
  observations: UniversalCommerceObservationV11[];
  primary: UniversalCommerceObservationV11;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function mapLifecycleToEvent(lifecycle: UniversalCompositionLifecycleV11): BuyFlowEmailEventType | null {
  switch (lifecycle) {
    case 'order_created': return 'order_created';
    case 'order_processing':
    case 'order_cancelled':
    case 'payment_issue': return 'order_updated';
    case 'shipped':
    case 'in_transit':
    case 'out_for_delivery': return 'shipment';
    case 'delivered': return 'delivery';
    case 'invoice': return 'invoice_or_receipt';
    case 'payment_completed': return 'payment_completed';
    case 'refund': return 'refund';
    case 'return': return 'return';
    case 'unknown': return null;
  }
}

function observation(input: {
  lifecycle: UniversalCompositionLifecycleV11;
  decision: UniversalCompositionDecisionV11;
  confidence: number;
  evidence?: string[];
  negativeEvidence?: string[];
}): UniversalCommerceObservationV11 {
  return {
    version: UNIVERSAL_COMMERCE_COMPOSITION_V1_1_VERSION,
    lifecycle: input.lifecycle,
    eventType: mapLifecycleToEvent(input.lifecycle),
    decision: input.decision,
    confidence: input.confidence,
    evidence: unique(input.evidence ?? []),
    negativeEvidence: unique(input.negativeEvidence ?? []),
  };
}

const REVIEW_REQUEST = /\b(?:how did (?:it|your order|your purchase) go|rate (?:your )?(?:order|purchase|product|experience)|review (?:your )?(?:order|purchase|product)|ertekeld|ertekelesed|velemenyed)\b/i;
const INVOICE_NON_FINAL = /\b(?:proforma|pro forma|dijbekero|fizetesi bekero|payment request|zahlungsaufforderung|sztorno|storno|credit note|helyesbito szamla)\b/i;

function hasVisibleObject(semantics: UniversalCommerceSemanticsV11Result, object: string): boolean {
  return semantics.visibleEvidence.includes(`visible_${object.toLowerCase()}`);
}

function hasVisibleAction(semantics: UniversalCommerceSemanticsV11Result, action: string): boolean {
  return semantics.visibleEvidence.includes(`visible_${action.toLowerCase()}`);
}

function hasPdfAttachment(document: EmailDocumentV1): boolean {
  return document.attachments.some((attachment) => {
    if (attachment.isInline) return false;
    const filename = attachment.filename.toLowerCase();
    const contentType = attachment.contentType.toLowerCase();
    return contentType === 'application/pdf' || filename.endsWith('.pdf');
  });
}

function hasCommerceStructure(document: EmailDocumentV1): boolean {
  return [
    document.sections.some((section) => section.type === 'order_summary'),
    document.signals.products.length > 0,
    document.signals.amounts.length > 0,
    document.signals.paymentMethods.length > 0,
    document.signals.shippingMethods.length > 0,
  ].filter(Boolean).length >= 2;
}

function dedupeObservations(values: UniversalCommerceObservationV11[]): UniversalCommerceObservationV11[] {
  const best = new Map<string, UniversalCommerceObservationV11>();
  for (const value of values) {
    const key = `${value.lifecycle}:${value.eventType ?? 'none'}`;
    const existing = best.get(key);
    if (!existing || value.confidence > existing.confidence) best.set(key, value);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

function unknownObservation(
  decision: UniversalCompositionDecisionV11 = 'review',
  confidence = 0,
  negativeEvidence: string[] = [],
): UniversalCommerceObservationV11 {
  return observation({ lifecycle: 'unknown', decision, confidence, negativeEvidence });
}

export function composeUniversalCommerceObservationsV11(
  document: EmailDocumentV1,
  semantics: UniversalCommerceSemanticsV11Result = evaluateUniversalCommerceSemanticsV11(document),
): UniversalCommerceObservationV11[] {
  const text = normalize(`${document.subject ?? ''}\n${document.text}`);
  const hasOrderIdentity = document.signals.orderNumbers.length > 0;
  const hasTrackingIdentity = document.signals.trackingNumbers.length > 0;
  const hasMoney = document.signals.amounts.length > 0;
  const pdf = hasPdfAttachment(document);
  const future = semantics.modifiers.includes('FUTURE');
  const negated = semantics.modifiers.includes('NEGATED');
  const values: UniversalCommerceObservationV11[] = [];

  if (REVIEW_REQUEST.test(text)) {
    return [unknownObservation('blocked', 0.99, ['review_request_language'])];
  }

  if (hasVisibleObject(semantics, 'INVOICE')) {
    if (INVOICE_NON_FINAL.test(text)) {
      values.push(observation({
        lifecycle: 'unknown',
        decision: 'review',
        confidence: 0.76,
        evidence: ['invoice_object'],
        negativeEvidence: ['invoice_non_final_or_correction_language'],
      }));
    } else {
      const attached = hasVisibleAction(semantics, 'ATTACH');
      const available = hasVisibleAction(semantics, 'MAKE_AVAILABLE');
      const received = hasVisibleAction(semantics, 'RECEIVE');
      const issued = hasVisibleAction(semantics, 'ISSUE');
      const technicalInvoiceDocument = semantics.technicalEvidence.some((item) =>
        ['url_invoice', 'url_invoice_document', 'technical_invoice', 'technical_invoice_document'].includes(item));
      const finalAction = attached || available || received || issued;

      if (pdf && finalAction) {
        values.push(observation({
          lifecycle: 'invoice',
          decision: 'actionable',
          confidence: 0.97,
          evidence: [
            'invoice_object',
            'pdf_attachment',
            ...(attached ? ['invoice_attached'] : []),
            ...(available ? ['invoice_available'] : []),
            ...(received ? ['invoice_received'] : []),
            ...(issued ? ['invoice_issued'] : []),
          ],
        }));
      } else if (finalAction && (technicalInvoiceDocument || hasMoney)) {
        values.push(observation({
          lifecycle: 'invoice',
          decision: 'actionable',
          confidence: technicalInvoiceDocument ? 0.94 : 0.92,
          evidence: [
            'invoice_object',
            ...(technicalInvoiceDocument ? ['invoice_document_endpoint'] : []),
            ...(hasMoney ? ['money_candidate'] : []),
            ...(available ? ['invoice_available'] : []),
            ...(received ? ['invoice_received'] : []),
            ...(issued ? ['invoice_issued'] : []),
          ],
          negativeEvidence: pdf ? [] : ['invoice_pdf_not_attached'],
        }));
      } else if (finalAction) {
        values.push(observation({
          lifecycle: 'invoice',
          decision: 'review',
          confidence: 0.84,
          evidence: ['invoice_object'],
          negativeEvidence: ['invoice_delivery_not_independently_corroborated'],
        }));
      }
    }
  }

  if (hasVisibleObject(semantics, 'ORDER') && hasVisibleAction(semantics, 'CANCEL')) {
    values.push(observation({
      lifecycle: 'order_cancelled',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.97 : 0.82,
      evidence: ['order_object', 'cancel_action', ...(hasOrderIdentity ? ['order_identity'] : [])],
    }));
  }

  if (
    (hasVisibleObject(semantics, 'DELIVERY') || hasVisibleObject(semantics, 'SHIPMENT')) &&
    hasVisibleAction(semantics, 'DELIVER')
  ) {
    values.push(observation({
      lifecycle: negated || future ? 'unknown' : 'delivered',
      decision: negated || future ? 'review' : hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: negated || future ? 0.7 : hasTrackingIdentity ? 0.98 : hasOrderIdentity ? 0.93 : 0.81,
      evidence: ['delivery_object', 'deliver_action', ...(hasTrackingIdentity ? ['tracking_identity'] : []), ...(hasOrderIdentity ? ['order_identity'] : [])],
      negativeEvidence: negated ? ['negated_delivery'] : future ? ['future_delivery'] : [],
    }));
  }

  if (
    (hasVisibleObject(semantics, 'DELIVERY') || hasVisibleObject(semantics, 'SHIPMENT')) &&
    hasVisibleAction(semantics, 'OUT_FOR_DELIVERY')
  ) {
    values.push(observation({
      lifecycle: negated ? 'unknown' : 'out_for_delivery',
      decision: negated ? 'review' : hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: negated ? 0.7 : hasTrackingIdentity ? 0.97 : hasOrderIdentity ? 0.91 : 0.8,
      evidence: ['delivery_object', 'out_for_delivery_action', ...(hasTrackingIdentity ? ['tracking_identity'] : []), ...(hasOrderIdentity ? ['order_identity'] : [])],
      negativeEvidence: negated ? ['negated_out_for_delivery'] : [],
    }));
  }

  if (
    (hasVisibleObject(semantics, 'ORDER') || hasVisibleObject(semantics, 'SHIPMENT')) &&
    hasVisibleAction(semantics, 'HANDOFF_TO_CARRIER')
  ) {
    values.push(observation({
      lifecycle: future || negated ? 'order_processing' : 'shipped',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: future || negated ? (hasOrderIdentity ? 0.92 : 0.79) : hasTrackingIdentity ? 0.98 : hasOrderIdentity ? 0.93 : 0.8,
      evidence: ['carrier_handoff_action', ...(hasTrackingIdentity ? ['tracking_identity'] : []), ...(hasOrderIdentity ? ['order_identity'] : [])],
      negativeEvidence: future ? ['future_handoff'] : negated ? ['negated_handoff'] : [],
    }));
  }

  if (
    (hasVisibleObject(semantics, 'ORDER') || hasVisibleObject(semantics, 'SHIPMENT')) &&
    hasVisibleAction(semantics, 'MOVE') &&
    !future && !negated
  ) {
    values.push(observation({
      lifecycle: 'in_transit',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.96 : hasOrderIdentity ? 0.9 : 0.78,
      evidence: ['movement_action', ...(hasTrackingIdentity ? ['tracking_identity'] : []), ...(hasOrderIdentity ? ['order_identity'] : [])],
    }));
  }

  if (hasVisibleObject(semantics, 'PAYMENT') && hasVisibleAction(semantics, 'PAY_FAIL')) {
    values.push(observation({
      lifecycle: 'payment_issue',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.95 : 0.82,
      evidence: ['payment_object', 'payment_fail_action', ...(hasOrderIdentity ? ['order_identity'] : [])],
    }));
  }

  if (hasVisibleObject(semantics, 'PAYMENT') && hasVisibleAction(semantics, 'PAY_SUCCESS')) {
    values.push(observation({
      lifecycle: 'payment_completed',
      decision: hasOrderIdentity || hasMoney ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.96 : hasMoney ? 0.9 : 0.8,
      evidence: ['payment_object', 'payment_success_action', ...(hasOrderIdentity ? ['order_identity'] : []), ...(hasMoney ? ['money_candidate'] : [])],
    }));
  }

  if (hasVisibleObject(semantics, 'REFUND') && hasVisibleAction(semantics, 'REFUND')) {
    values.push(observation({
      lifecycle: 'refund',
      decision: !negated && (hasOrderIdentity || hasMoney) ? 'actionable' : 'review',
      confidence: !negated && hasOrderIdentity ? 0.95 : !negated && hasMoney ? 0.9 : 0.8,
      evidence: ['refund_object', 'refund_action', ...(hasOrderIdentity ? ['order_identity'] : []), ...(hasMoney ? ['money_candidate'] : [])],
      negativeEvidence: negated ? ['negated_refund'] : [],
    }));
  }

  if (hasVisibleObject(semantics, 'RETURN') && hasVisibleAction(semantics, 'RETURN')) {
    values.push(observation({
      lifecycle: 'return',
      decision: !negated && (hasOrderIdentity || hasTrackingIdentity) ? 'actionable' : 'review',
      confidence: !negated && (hasOrderIdentity || hasTrackingIdentity) ? 0.94 : 0.8,
      evidence: ['return_object', 'return_action', ...(hasOrderIdentity ? ['order_identity'] : []), ...(hasTrackingIdentity ? ['tracking_identity'] : [])],
      negativeEvidence: negated ? ['negated_return'] : [],
    }));
  }

  if (
    hasVisibleObject(semantics, 'ORDER') &&
    (hasVisibleAction(semantics, 'PROCESS') || hasVisibleAction(semantics, 'PACK'))
  ) {
    values.push(observation({
      lifecycle: 'order_processing',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.94 : 0.8,
      evidence: ['order_object', hasVisibleAction(semantics, 'PACK') ? 'pack_action' : 'process_action', ...(hasOrderIdentity ? ['order_identity'] : [])],
    }));
  }

  if (
    hasVisibleObject(semantics, 'ORDER') &&
    (hasVisibleAction(semantics, 'CREATE') || hasVisibleAction(semantics, 'CONFIRM') || hasVisibleAction(semantics, 'RECEIVE'))
  ) {
    const corroboratedOrder = semantics.corroboratedEvidence.includes('visible_plus_technical_order');
    const enoughEvidence = hasOrderIdentity && (hasCommerceStructure(document) || corroboratedOrder);
    values.push(observation({
      lifecycle: 'order_created',
      decision: enoughEvidence ? 'actionable' : 'review',
      confidence: enoughEvidence ? 0.97 : 0.82,
      evidence: [
        'order_object',
        hasVisibleAction(semantics, 'CONFIRM') ? 'confirm_action' : hasVisibleAction(semantics, 'RECEIVE') ? 'receive_action' : 'create_action',
        ...(hasOrderIdentity ? ['order_identity'] : []),
        ...(hasCommerceStructure(document) ? ['commerce_structure'] : []),
        ...(corroboratedOrder ? ['cross_layer_order_corroboration'] : []),
      ],
    }));
  }

  return dedupeObservations(values.length > 0 ? values : [unknownObservation()]);
}

export function composeUniversalCommerceV11(
  document: EmailDocumentV1,
  semantics: UniversalCommerceSemanticsV11Result = evaluateUniversalCommerceSemanticsV11(document),
): UniversalCommerceCompositionV11Result {
  const observations = composeUniversalCommerceObservationsV11(document, semantics);
  return {
    version: UNIVERSAL_COMMERCE_COMPOSITION_V1_1_VERSION,
    observations,
    primary: observations[0] ?? unknownObservation(),
  };
}
