import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { CanonicalEventType, PurchaseCreationAuthority, SourceRole } from './types.js';

export const PURCHASE_CREATION_AUTHORITY_V1_VERSION = 'purchase-creation-authority-v1';

export interface PurchaseCreationAuthorityDecision {
  version: typeof PURCHASE_CREATION_AUTHORITY_V1_VERSION;
  authority: PurchaseCreationAuthority;
  reasons: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .toLowerCase();
}

const NON_ACCEPTANCE_PATTERNS = [
  /\b(?:automatikus|automatikusan kuldott).{0,120}(?:visszaigazolas|uzenet|ertesites|e-?mail|email).{0,180}nem jelenti.{0,180}(?:a )?szerzodes (?:letrejottet|megkoteset)\b/i,
  /\b(?:visszaigazolas|uzenet|ertesites|e-?mail|email).{0,180}nem jelenti.{0,180}(?:a )?szerzodes (?:letrejottet|megkoteset)\b/i,
  /\b(?:rendeles|megrendeles).{0,120}(?:rogzitese|beerkezese).{0,120}nem jelenti.{0,120}(?:a )?(?:rendeles|megrendeles) elfogadasat\b/i,
  /\b(?:rendelesed|megrendelesed|rendeles|megrendeles) (?:meg|be)?erkezett.{0,120}(?:de|azonban).{0,120}(?:meg )?nem (?:fogadtuk el|kerult elfogadasra)\b/i,
  /\b(?:csak|csupan).{0,100}(?:rendeles|megrendeles|ajanlat).{0,100}(?:beerkezeset|atvetelet).{0,100}(?:igazolja|erositi meg)\b/i,
  /\b(?:e-?mail|email|uzenet|ertesites)\b.{0,120}\bnem minosul\b.{0,120}\b(?:rendeles|megrendeles)\w*\s+visszaigazolas\w*\b/i,
  /\b(?:csak|csupan)\b.{0,100}\b(?:veteli\s+)?ajanlat\b.{0,100}\b(?:megerkezes(?:erol|et)|beerkezes(?:erol|et)|atvetel(?:erol|et))\b.{0,100}\b(?:ertesit|igazol|erosit)\w*\b/i,
  /\bthis (?:e-?mail|email|message|acknowledg(?:e)?ment).{0,160}(?:does not mean|does not constitute).{0,160}(?:a )?contract\b/i,
  /\bthis (?:e-?mail|email|message).{0,120}(?:does not constitute|is not).{0,120}(?:acceptance of (?:your )?(?:order|offer)|order confirmation)\b/i,
  /\byour order has not yet been accepted\b/i,
  /\bwe (?:have )?received your order.{0,80}but.{0,80}(?:have )?not (?:yet )?accepted\b/i,
  /\b(?:only|merely) acknowledges? receipt of (?:your )?(?:purchase offer|order request|order)\b/i,
];

const PURCHASE_ROOT_PATTERNS = [
  /\b(?:rendelesed|megrendelesed|rendeles|megrendeles)\b.{0,100}\b(?:megkaptuk|beerkezett|beerkezett|rogzitettuk|felvettuk|elfogadtuk|visszaigazoltuk)\b/i,
  /\b(?:megkaptuk|rogzitettuk|felvettuk|elfogadtuk|visszaigazoltuk)\b.{0,100}\b(?:a )?(?:rendelesedet|megrendelesedet|rendelest|megrendelest)\b/i,
  /\b(?:koszonjuk|sikeres)\b.{0,80}\b(?:a )?(?:rendelesed|megrendelesed|rendeles|megrendeles)\b/i,
  /\b(?:rendeles|megrendeles)\w*\s+visszaigazolas\w*\b/i,
  /\b(?:order|purchase)\b.{0,100}\b(?:received|placed|accepted|confirmed|recorded)\b/i,
  /\b(?:received|accepted|confirmed|recorded)\b.{0,100}\b(?:your )?(?:order|purchase)\b/i,
  /\bthank(?:s| you)?\b.{0,80}\bfor (?:your )?order\b/i,
  /\b(?:bestellung)\b.{0,100}\b(?:erhalten|aufgenommen|angenommen|bestatigt)\b/i,
  /\b(?:commande)\b.{0,100}\b(?:recue|enregistree|confirmee|acceptee)\b/i,
  /\b(?:pedido)\b.{0,100}\b(?:recibido|registrado|confirmado|aceptado)\b/i,
  /\b(?:veteli\s+)?ajanlat\b.{0,100}\b(?:megerkezes(?:erol|et)|beerkezes(?:erol|et)|atvetel(?:erol|et))\b/i,
];

export function hasExplicitPurchaseNonAcceptance(document: EmailDocumentV1): boolean {
  const fresh = normalizeText(`${document.subject ?? ''}\n${document.text}`);
  return NON_ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(fresh));
}

/**
 * Independent order-root evidence. This answers "did this message establish or
 * acknowledge a concrete order root?" and is deliberately separate from the
 * message's primary lifecycle event. A message may therefore be primarily
 * ORDER_PROCESSING/ORDER_PACKING while also carrying deterministic root evidence.
 */
export function hasExplicitPurchaseRootEvidence(document: EmailDocumentV1): boolean {
  const fresh = normalizeText(`${document.subject ?? ''}\n${document.text}`);
  return PURCHASE_ROOT_PATTERNS.some((pattern) => pattern.test(fresh));
}

function structureSignalCount(document: EmailDocumentV1): number {
  return [
    document.sections.some((section) => section.type === 'order_summary'),
    document.signals.products.length > 0,
    document.signals.amounts.length > 0,
    document.signals.paymentMethods.length > 0,
    document.signals.shippingMethods.length > 0,
  ].filter(Boolean).length;
}

export function evaluatePurchaseCreationAuthority(input: {
  document: EmailDocumentV1;
  eventType: CanonicalEventType;
  sourceRole: SourceRole;
  orderId: string | null;
}): PurchaseCreationAuthorityDecision {
  const hasRootEvidence = hasExplicitPurchaseRootEvidence(input.document);

  // A true lifecycle-only message remains ineligible. The primary lifecycle
  // label is no longer the creation gate; explicit order-root evidence is.
  if (!hasRootEvidence) {
    return {
      version: PURCHASE_CREATION_AUTHORITY_V1_VERSION,
      authority: input.eventType === 'order_created' ? 'review' : 'none',
      reasons: [input.eventType === 'order_created' ? 'order_created_without_explicit_root_evidence' : 'no_purchase_root_evidence'],
    };
  }

  if (!input.orderId) {
    return {
      version: PURCHASE_CREATION_AUTHORITY_V1_VERSION,
      authority: 'review',
      reasons: ['purchase_root_evidence', 'missing_hard_order_identity'],
    };
  }

  if (input.sourceRole !== 'merchant') {
    return {
      version: PURCHASE_CREATION_AUTHORITY_V1_VERSION,
      authority: 'review',
      reasons: ['purchase_root_evidence', 'merchant_source_authority_unproven'],
    };
  }

  if (hasExplicitPurchaseNonAcceptance(input.document)) {
    return {
      version: PURCHASE_CREATION_AUTHORITY_V1_VERSION,
      authority: 'review',
      reasons: ['purchase_root_evidence', 'explicit_order_non_acceptance_or_contract_disclaimer'],
    };
  }

  if (structureSignalCount(input.document) < 2) {
    return {
      version: PURCHASE_CREATION_AUTHORITY_V1_VERSION,
      authority: 'review',
      reasons: ['purchase_root_evidence', 'insufficient_independent_commerce_structure'],
    };
  }

  return {
    version: PURCHASE_CREATION_AUTHORITY_V1_VERSION,
    authority: 'authorized',
    reasons: [
      'purchase_root_evidence',
      'hard_order_identity',
      'merchant_source_authority',
      'independent_commerce_structure',
      'no_explicit_non_acceptance_conflict',
      ...(input.eventType === 'order_created' ? ['primary_event_order_created'] : ['lifecycle_event_with_independent_order_root']),
    ],
  };
}
