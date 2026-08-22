import type { EvidenceField, EvidenceProduct, ResolvedCommerceEvent } from './types.js';

export type ValidationSeverity = 'info' | 'warning' | 'review';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  fields: EvidenceField[];
  message: string;
}

export interface CommerceValidationResult {
  issues: ValidationIssue[];
  reviewRequired: boolean;
}

function resolvedValue<T>(field: { status: string; value: T | null }): T | null {
  return field.status === 'resolved' ? field.value : null;
}

function productCurrencies(products: EvidenceProduct[] | null): string[] {
  return [...new Set((products ?? [])
    .map((product) => product.currency)
    .filter((currency): currency is NonNullable<EvidenceProduct['currency']> => Boolean(currency)))];
}

/**
 * Cross-field validation is deliberately conservative.
 * Missing-but-plausible data produces warnings, while only hard semantic
 * contradictions produce REVIEW. It never mutates resolved field values.
 */
export function validateResolvedCommerceEvent(event: ResolvedCommerceEvent): CommerceValidationResult {
  const issues: ValidationIssue[] = [];
  const eventType = resolvedValue(event.eventType);
  const paymentStatus = resolvedValue(event.paymentStatus);
  const total = resolvedValue(event.total);
  const currency = resolvedValue(event.currency);
  const tracking = resolvedValue(event.trackingNumber);
  const products = resolvedValue(event.products);

  if ((total !== null) !== (currency !== null)) {
    issues.push({
      code: 'money_pair_incomplete',
      severity: 'warning',
      fields: ['total', 'currency'],
      message: 'A resolved total and currency should normally be present together.',
    });
  }

  if ((eventType === 'shipment' || eventType === 'delivery') && tracking === null) {
    issues.push({
      code: 'lifecycle_tracking_missing',
      severity: 'warning',
      fields: ['event_type', 'tracking_number'],
      message: 'Shipment/delivery was resolved without a tracking number.',
    });
  }

  if ((eventType === 'payment_completed' || eventType === 'refund') && total === null) {
    issues.push({
      code: 'payment_event_amount_missing',
      severity: 'warning',
      fields: ['event_type', 'total'],
      message: 'Payment/refund event was resolved without an amount.',
    });
  }

  if (eventType === 'payment_completed' && paymentStatus !== null && paymentStatus !== 'paid') {
    issues.push({
      code: 'payment_completed_status_contradiction',
      severity: 'review',
      fields: ['event_type', 'payment_status'],
      message: 'payment_completed conflicts with a non-paid payment status.',
    });
  }

  if (eventType === 'refund' && paymentStatus !== null && paymentStatus !== 'refunded') {
    issues.push({
      code: 'refund_status_contradiction',
      severity: 'review',
      fields: ['event_type', 'payment_status'],
      message: 'refund conflicts with a non-refunded payment status.',
    });
  }

  if (eventType === 'order_created' && paymentStatus === 'refunded') {
    issues.push({
      code: 'new_order_refunded_contradiction',
      severity: 'review',
      fields: ['event_type', 'payment_status'],
      message: 'A newly created order cannot simultaneously be finalized as refunded.',
    });
  }

  const lineCurrencies = productCurrencies(products);
  if (currency && lineCurrencies.some((lineCurrency) => lineCurrency !== currency)) {
    issues.push({
      code: 'product_currency_mismatch',
      severity: 'warning',
      fields: ['currency', 'product'],
      message: 'At least one resolved product currency differs from the resolved event currency.',
    });
  }

  return {
    issues,
    reviewRequired: issues.some((issue) => issue.severity === 'review'),
  };
}
