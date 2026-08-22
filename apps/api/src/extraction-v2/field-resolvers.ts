import { claimsFor, resolveField } from './resolver.js';
import type {
  EvidenceBundle,
  EvidenceClaim,
  EvidenceField,
  EvidenceProduct,
  ResolvedCommerceEvent,
  ResolvedField,
} from './types.js';

const QUALIFIER_RANKS: Partial<Record<EvidenceField, Record<string, number>>> = {
  order_number: {
    explicit_order_label: 500,
    explicit_order_hash: 500,
    explicit_numbered_order_phrase: 490,
    contextual_order_identifier: 400,
    document_order_candidate: 300,
  },
  tracking_number: {
    explicit_tracking_label: 500,
    contextual_tracking_identifier: 420,
    document_tracking_candidate: 300,
  },
  total: {
    explicit_final_total: 500,
    explicit_payment_amount: 460,
    single_unambiguous_money_candidate: 250,
  },
  currency: {
    explicit_final_total: 500,
    explicit_payment_amount: 460,
    single_unambiguous_money_candidate: 250,
  },
  merchant: {
    explicit_merchant_label: 500,
    explicit_sender_label: 470,
    sender_display_name_fallback: 220,
  },
  payment_status: {
    explicit_payment_failure: 500,
    explicit_refund_completion: 500,
    explicit_cod_evidence: 500,
    explicit_paid_evidence: 500,
  },
  invoice_number: {
    explicit_invoice_label: 500,
    contextual_invoice_identifier: 420,
  },
  payment_reference: {
    explicit_payment_reference_label: 500,
  },
  product: {
    document_product_candidate: 500,
    structured_table_product_row: 490,
    explicit_product_block: 480,
    quantity_prefixed_product_row: 430,
  },
};

function sourceFallbackRank(claim: EvidenceClaim): number {
  switch (claim.source) {
    case 'provider_adapter':
      return 450;
    case 'attachment':
      return 360;
    case 'document_structure':
      return 300;
    case 'subject':
      return 280;
    case 'body':
      return 270;
    case 'header':
      return 240;
    case 'sender':
      return 200;
    default:
      return 100;
  }
}

export function fieldClaimRank(field: EvidenceField, claim: EvidenceClaim): number {
  const qualifierMap = QUALIFIER_RANKS[field];
  const qualifierRank = Math.max(
    0,
    ...(claim.qualifiers ?? []).map((qualifier) => qualifierMap?.[qualifier] ?? 0),
  );
  return Math.max(qualifierRank, sourceFallbackRank(claim));
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeTextIdentity(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function resolveStringField(input: {
  bundle: EvidenceBundle;
  field: EvidenceField;
  minimumConfidence: number;
  normalize: (value: string) => string;
  claims?: EvidenceClaim<string>[];
}): ResolvedField<string> {
  return resolveField({
    claims: input.claims ?? claimsFor<string>(input.bundle, input.field),
    rank: (claim) => fieldClaimRank(input.field, claim),
    minimumConfidence: input.minimumConfidence,
    equivalent: (a, b) => input.normalize(a) === input.normalize(b),
  });
}

function resolveNumberField(input: {
  bundle: EvidenceBundle;
  field: EvidenceField;
  minimumConfidence: number;
  claims?: EvidenceClaim<number>[];
}): ResolvedField<number> {
  return resolveField({
    claims: input.claims ?? claimsFor<number>(input.bundle, input.field),
    rank: (claim) => fieldClaimRank(input.field, claim),
    minimumConfidence: input.minimumConfidence,
    equivalent: (a, b) => Math.abs(a - b) < 0.000001,
  });
}

function isPaymentAmountEligible(eventType: ResolvedField<string>): boolean {
  if (eventType.status !== 'resolved' || !eventType.value) return false;
  const normalized = normalizeToken(eventType.value);
  return normalized === 'payment_completed' || normalized === 'refund';
}

function filterContextualMoneyClaims<T>(
  claims: EvidenceClaim<T>[],
  eventType: ResolvedField<string>,
): EvidenceClaim<T>[] {
  const allowPaymentAmount = isPaymentAmountEligible(eventType);
  return claims.filter((claim) => (
    !claim.qualifiers?.includes('explicit_payment_amount') || allowPaymentAmount
  ));
}

function normalizedProductName(value: string): string {
  return normalizeTextIdentity(value);
}

function productFieldConflict<T>(values: Array<T | null>): boolean {
  const present = values.filter((value): value is T => value !== null);
  if (present.length <= 1) return false;
  const first = JSON.stringify(present[0]);
  return present.some((value) => JSON.stringify(value) !== first);
}

function mergeEquivalentProductClaims(claims: EvidenceClaim<EvidenceProduct>[]): EvidenceProduct | null {
  const first = claims[0]?.value;
  if (!first) return null;
  if (claims.some((claim) => normalizedProductName(claim.value.name) !== normalizedProductName(first.name))) {
    return null;
  }

  const quantities = claims.map((claim) => claim.value.quantity);
  const unitPrices = claims.map((claim) => claim.value.unitPrice);
  const totalPrices = claims.map((claim) => claim.value.totalPrice);
  const currencies = claims.map((claim) => claim.value.currency);
  if (
    productFieldConflict(quantities)
    || productFieldConflict(unitPrices)
    || productFieldConflict(totalPrices)
    || productFieldConflict(currencies)
  ) {
    return null;
  }

  return {
    name: first.name,
    quantity: quantities.find((value) => value !== null) ?? null,
    unitPrice: unitPrices.find((value) => value !== null) ?? null,
    totalPrice: totalPrices.find((value) => value !== null) ?? null,
    currency: currencies.find((value) => value !== null) ?? null,
  };
}

export function resolveProducts(bundle: EvidenceBundle): ResolvedField<EvidenceProduct[]> {
  const eligible = claimsFor<EvidenceProduct>(bundle, 'product')
    .filter((claim) => Number.isFinite(claim.confidence) && claim.confidence >= 0.90);

  if (eligible.length === 0) {
    return { value: null, confidence: null, status: 'missing', provenance: [] };
  }

  const groups = new Map<string, EvidenceClaim<EvidenceProduct>[]>();
  for (const claim of eligible) {
    const key = normalizedProductName(claim.value.name);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }

  const products: EvidenceProduct[] = [];
  const provenance: EvidenceClaim<EvidenceProduct>[] = [];
  const confidences: number[] = [];

  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => {
      const rankDiff = fieldClaimRank('product', b) - fieldClaimRank('product', a);
      if (rankDiff !== 0) return rankDiff;
      return b.confidence - a.confidence;
    });
    const bestRank = fieldClaimRank('product', ranked[0]!);
    const strongest = ranked.filter((claim) => fieldClaimRank('product', claim) === bestRank);
    const merged = mergeEquivalentProductClaims(strongest);
    if (!merged) {
      return {
        value: null,
        confidence: null,
        status: 'conflict',
        provenance: strongest,
      };
    }
    products.push(merged);
    provenance.push(...strongest);
    confidences.push(Math.max(...strongest.map((claim) => claim.confidence)));
  }

  return {
    value: products,
    confidence: confidences.length ? Math.min(...confidences) : null,
    status: 'resolved',
    provenance,
  };
}

export function resolveCommerceEvent(bundle: EvidenceBundle): ResolvedCommerceEvent {
  const eventType = resolveStringField({
    bundle,
    field: 'event_type',
    minimumConfidence: 0.85,
    normalize: normalizeToken,
  });
  const merchant = resolveStringField({
    bundle,
    field: 'merchant',
    minimumConfidence: 0.80,
    normalize: normalizeTextIdentity,
  });
  const orderNumber = resolveStringField({
    bundle,
    field: 'order_number',
    minimumConfidence: 0.80,
    normalize: normalizeIdentifier,
  });

  const totalClaims = filterContextualMoneyClaims(
    claimsFor<number>(bundle, 'total'),
    eventType,
  );
  const currencyClaims = filterContextualMoneyClaims(
    claimsFor<string>(bundle, 'currency'),
    eventType,
  );
  const total = resolveNumberField({
    bundle,
    field: 'total',
    minimumConfidence: 0.80,
    claims: totalClaims,
  });
  const currency = resolveStringField({
    bundle,
    field: 'currency',
    minimumConfidence: 0.80,
    normalize: normalizeToken,
    claims: currencyClaims,
  });

  const carrier = resolveStringField({
    bundle,
    field: 'carrier',
    minimumConfidence: 0.80,
    normalize: normalizeTextIdentity,
  });
  const trackingNumber = resolveStringField({
    bundle,
    field: 'tracking_number',
    minimumConfidence: 0.82,
    normalize: normalizeIdentifier,
  });
  const paymentStatus = resolveStringField({
    bundle,
    field: 'payment_status',
    minimumConfidence: 0.95,
    normalize: normalizeToken,
  });
  const invoiceNumber = resolveStringField({
    bundle,
    field: 'invoice_number',
    minimumConfidence: 0.90,
    normalize: normalizeIdentifier,
  });
  const paymentReference = resolveStringField({
    bundle,
    field: 'payment_reference',
    minimumConfidence: 0.90,
    normalize: normalizeIdentifier,
  });
  const products = resolveProducts(bundle);

  const resolvedByField: Array<[EvidenceField, ResolvedField<unknown>]> = [
    ['event_type', eventType],
    ['merchant', merchant],
    ['order_number', orderNumber],
    ['total', total],
    ['currency', currency],
    ['carrier', carrier],
    ['tracking_number', trackingNumber],
    ['payment_status', paymentStatus],
    ['invoice_number', invoiceNumber],
    ['payment_reference', paymentReference],
    ['product', products],
  ];
  const conflictFields = resolvedByField
    .filter(([, field]) => field.status === 'conflict')
    .map(([field]) => field);

  return {
    eventType,
    merchant,
    orderNumber,
    total,
    currency,
    carrier,
    trackingNumber,
    paymentStatus,
    invoiceNumber,
    paymentReference,
    products,
    reviewRequired: conflictFields.length > 0,
    conflictFields,
  };
}
