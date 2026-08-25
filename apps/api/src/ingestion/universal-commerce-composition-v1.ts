import type { BuyFlowEmailEventType } from '../ai/openai-email-extractor.js';
import type { EmailDocumentV1 } from './email-document.js';
import {
  evaluateUniversalCommerceSemanticsV1,
  type UniversalCommerceSemanticsV1Result,
} from './universal-commerce-semantics-v1.js';

export const UNIVERSAL_COMMERCE_COMPOSITION_V1_VERSION = 'universal-commerce-composition-v1';

export type UniversalCompositionLifecycle =
  | 'order_created'
  | 'order_processing'
  | 'order_cancelled'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'invoice'
  | 'payment_completed'
  | 'payment_issue'
  | 'refund'
  | 'return'
  | 'unknown';

export type UniversalCompositionDecision = 'actionable' | 'review' | 'blocked';

export interface UniversalCommerceCompositionV1Result {
  version: typeof UNIVERSAL_COMMERCE_COMPOSITION_V1_VERSION;
  lifecycle: UniversalCompositionLifecycle;
  eventType: BuyFlowEmailEventType | null;
  decision: UniversalCompositionDecision;
  confidence: number;
  evidence: string[];
  negativeEvidence: string[];
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

function mapLifecycleToEvent(lifecycle: UniversalCompositionLifecycle): BuyFlowEmailEventType | null {
  switch (lifecycle) {
    case 'order_created': return 'order_created';
    case 'order_processing':
    case 'order_cancelled':
    case 'payment_issue': return 'order_updated';
    case 'shipped':
    case 'out_for_delivery': return 'shipment';
    case 'delivered': return 'delivery';
    case 'invoice': return 'invoice_or_receipt';
    case 'payment_completed': return 'payment_completed';
    case 'refund': return 'refund';
    case 'return': return 'return';
    case 'unknown': return null;
  }
}

function result(input: {
  lifecycle: UniversalCompositionLifecycle;
  decision: UniversalCompositionDecision;
  confidence: number;
  evidence?: string[];
  negativeEvidence?: string[];
}): UniversalCommerceCompositionV1Result {
  return {
    version: UNIVERSAL_COMMERCE_COMPOSITION_V1_VERSION,
    lifecycle: input.lifecycle,
    eventType: mapLifecycleToEvent(input.lifecycle),
    decision: input.decision,
    confidence: input.confidence,
    evidence: unique(input.evidence ?? []),
    negativeEvidence: unique(input.negativeEvidence ?? []),
  };
}

const REVIEW_REQUEST = /\b(?:how did (?:it|your order|your purchase) go|rate (?:your )?(?:order|purchase|product|experience)|review (?:your )?(?:order|purchase|product)|ertekeld|ertekelesed|velemenyed)\b/i;
const INVOICE_AVAILABLE = /\b(?:mellekelt|csatolt|csatolva|kuldjuk|elkuldjuk|tovabbitjuk|emailben kuldjuk|elerheto|letoltheto|attached|enclosed|sent|available|download(?:able)?|anbei|angehangt|verfugbar|joint|disponible|adjunt[oa]|disponible)\b/i;
const INVOICE_NON_FINAL = /\b(?:proforma|pro forma|dijbekero|dijbekero|fizetesi bekero|payment request|zahlungsaufforderung|sztorno|storno|credit note|helyesbito szamla)\b/i;

function visibleObject(semantics: UniversalCommerceSemanticsV1Result, object: string): boolean {
  return semantics.visibleEvidence.includes(`visible_${object.toLowerCase()}`);
}

function visibleAction(semantics: UniversalCommerceSemanticsV1Result, action: string): boolean {
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
  const signals = [
    document.sections.some((section) => section.type === 'order_summary'),
    document.signals.products.length > 0,
    document.signals.amounts.length > 0,
    document.signals.paymentMethods.length > 0,
    document.signals.shippingMethods.length > 0,
  ];
  return signals.filter(Boolean).length >= 2;
}

export function composeUniversalCommerceEventV1(
  document: EmailDocumentV1,
  semantics: UniversalCommerceSemanticsV1Result = evaluateUniversalCommerceSemanticsV1(document),
): UniversalCommerceCompositionV1Result {
  const text = normalize(`${document.subject ?? ''}\n${document.text}`);
  const hasOrderIdentity = document.signals.orderNumbers.length > 0;
  const hasTrackingIdentity = document.signals.trackingNumbers.length > 0;
  const hasMoney = document.signals.amounts.length > 0;
  const pdf = hasPdfAttachment(document);
  const future = semantics.modifiers.includes('FUTURE');
  const negated = semantics.modifiers.includes('NEGATED');

  if (REVIEW_REQUEST.test(text)) {
    return result({
      lifecycle: 'unknown',
      decision: 'blocked',
      confidence: 0.99,
      negativeEvidence: ['review_request_language'],
    });
  }

  // Invoice composition is deliberately merchant-agnostic: object + delivery/availability
  // semantics + a real PDF attachment can establish a final invoice event.
  if (visibleObject(semantics, 'INVOICE')) {
    const nonFinal = INVOICE_NON_FINAL.test(text);
    const available = INVOICE_AVAILABLE.test(text);
    const issued = visibleAction(semantics, 'ISSUE');
    if (nonFinal) {
      return result({
        lifecycle: 'unknown',
        decision: 'review',
        confidence: 0.76,
        evidence: ['invoice_object'],
        negativeEvidence: ['invoice_non_final_or_correction_language'],
      });
    }
    if (pdf && (available || issued)) {
      return result({
        lifecycle: 'invoice',
        decision: 'actionable',
        confidence: 0.97,
        evidence: [
          'invoice_object',
          'pdf_attachment',
          available ? 'invoice_available_or_sent_language' : 'invoice_issued_language',
        ],
      });
    }
    if (issued || available) {
      return result({
        lifecycle: 'invoice',
        decision: 'review',
        confidence: 0.86,
        evidence: ['invoice_object', issued ? 'invoice_issued_language' : 'invoice_available_or_sent_language'],
        negativeEvidence: ['invoice_pdf_not_present'],
      });
    }
  }

  if (visibleObject(semantics, 'ORDER') && visibleAction(semantics, 'CANCEL')) {
    return result({
      lifecycle: 'order_cancelled',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.97 : 0.82,
      evidence: ['order_object', 'cancel_action', ...(hasOrderIdentity ? ['order_identity'] : [])],
    });
  }

  if (
    (visibleObject(semantics, 'DELIVERY') || visibleObject(semantics, 'SHIPMENT')) &&
    visibleAction(semantics, 'DELIVER')
  ) {
    if (negated || future) {
      return result({
        lifecycle: 'unknown',
        decision: 'review',
        confidence: 0.7,
        evidence: ['delivery_object', 'deliver_action'],
        negativeEvidence: [negated ? 'negated' : 'future'],
      });
    }
    return result({
      lifecycle: 'delivered',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.98 : hasOrderIdentity ? 0.93 : 0.81,
      evidence: [
        'delivery_object',
        'deliver_action',
        ...(hasTrackingIdentity ? ['tracking_identity'] : []),
        ...(hasOrderIdentity ? ['order_identity'] : []),
      ],
    });
  }

  if (
    (visibleObject(semantics, 'DELIVERY') || visibleObject(semantics, 'SHIPMENT')) &&
    visibleAction(semantics, 'OUT_FOR_DELIVERY') &&
    !negated
  ) {
    return result({
      lifecycle: 'out_for_delivery',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.97 : hasOrderIdentity ? 0.91 : 0.8,
      evidence: [
        'delivery_object',
        'out_for_delivery_action',
        ...(hasTrackingIdentity ? ['tracking_identity'] : []),
        ...(hasOrderIdentity ? ['order_identity'] : []),
      ],
    });
  }

  if (
    (visibleObject(semantics, 'ORDER') || visibleObject(semantics, 'SHIPMENT')) &&
    visibleAction(semantics, 'HANDOFF_TO_CARRIER')
  ) {
    if (future || negated) {
      return result({
        lifecycle: 'order_processing',
        decision: hasOrderIdentity ? 'actionable' : 'review',
        confidence: hasOrderIdentity ? 0.92 : 0.79,
        evidence: ['carrier_handoff_action', ...(hasOrderIdentity ? ['order_identity'] : [])],
        negativeEvidence: [future ? 'future_handoff' : 'negated_handoff'],
      });
    }
    return result({
      lifecycle: 'shipped',
      decision: hasTrackingIdentity || hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasTrackingIdentity ? 0.98 : hasOrderIdentity ? 0.93 : 0.8,
      evidence: [
        'carrier_handoff_action',
        ...(hasTrackingIdentity ? ['tracking_identity'] : []),
        ...(hasOrderIdentity ? ['order_identity'] : []),
      ],
    });
  }

  if (visibleObject(semantics, 'PAYMENT') && visibleAction(semantics, 'PAY_FAIL')) {
    return result({
      lifecycle: 'payment_issue',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.95 : 0.82,
      evidence: ['payment_object', 'payment_fail_action', ...(hasOrderIdentity ? ['order_identity'] : [])],
    });
  }

  if (visibleObject(semantics, 'PAYMENT') && visibleAction(semantics, 'PAY_SUCCESS')) {
    return result({
      lifecycle: 'payment_completed',
      decision: hasOrderIdentity || hasMoney ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.96 : hasMoney ? 0.9 : 0.8,
      evidence: [
        'payment_object',
        'payment_success_action',
        ...(hasOrderIdentity ? ['order_identity'] : []),
        ...(hasMoney ? ['money_candidate'] : []),
      ],
    });
  }

  if (visibleObject(semantics, 'REFUND') && visibleAction(semantics, 'REFUND')) {
    return result({
      lifecycle: 'refund',
      decision: !negated && (hasOrderIdentity || hasMoney) ? 'actionable' : 'review',
      confidence: !negated && hasOrderIdentity ? 0.95 : !negated && hasMoney ? 0.9 : 0.8,
      evidence: ['refund_object', 'refund_action', ...(hasOrderIdentity ? ['order_identity'] : []), ...(hasMoney ? ['money_candidate'] : [])],
      negativeEvidence: negated ? ['negated_refund'] : [],
    });
  }

  if (visibleObject(semantics, 'RETURN') && visibleAction(semantics, 'RETURN')) {
    return result({
      lifecycle: 'return',
      decision: !negated && (hasOrderIdentity || hasTrackingIdentity) ? 'actionable' : 'review',
      confidence: !negated && (hasOrderIdentity || hasTrackingIdentity) ? 0.94 : 0.8,
      evidence: ['return_object', 'return_action', ...(hasOrderIdentity ? ['order_identity'] : []), ...(hasTrackingIdentity ? ['tracking_identity'] : [])],
      negativeEvidence: negated ? ['negated_return'] : [],
    });
  }

  if (
    visibleObject(semantics, 'ORDER') &&
    (visibleAction(semantics, 'PROCESS') || visibleAction(semantics, 'PACK'))
  ) {
    return result({
      lifecycle: 'order_processing',
      decision: hasOrderIdentity ? 'actionable' : 'review',
      confidence: hasOrderIdentity ? 0.94 : 0.8,
      evidence: [
        'order_object',
        visibleAction(semantics, 'PACK') ? 'pack_action' : 'process_action',
        ...(hasOrderIdentity ? ['order_identity'] : []),
      ],
    });
  }

  if (
    visibleObject(semantics, 'ORDER') &&
    (visibleAction(semantics, 'CREATE') || visibleAction(semantics, 'CONFIRM') || visibleAction(semantics, 'RECEIVE'))
  ) {
    const corroboratedOrder = semantics.corroboratedEvidence.includes('visible_plus_technical_order');
    const enoughEvidence = hasOrderIdentity && (hasCommerceStructure(document) || corroboratedOrder);
    return result({
      lifecycle: 'order_created',
      decision: enoughEvidence ? 'actionable' : 'review',
      confidence: enoughEvidence ? 0.97 : 0.82,
      evidence: [
        'order_object',
        visibleAction(semantics, 'CONFIRM') ? 'confirm_action' : visibleAction(semantics, 'RECEIVE') ? 'receive_action' : 'create_action',
        ...(hasOrderIdentity ? ['order_identity'] : []),
        ...(hasCommerceStructure(document) ? ['commerce_structure'] : []),
        ...(corroboratedOrder ? ['cross_layer_order_corroboration'] : []),
      ],
    });
  }

  return result({
    lifecycle: 'unknown',
    decision: 'review',
    confidence: 0,
    evidence: semantics.corroboratedEvidence,
  });
}
