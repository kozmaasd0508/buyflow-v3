import type { NormalizedEmail } from '../email/types.js';
import { runExtractionEngineV2, type ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import type { ResolvedField } from '../extraction-v2/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { planNormalizedInboundEmail, type NormalizedInboundPlan } from './normalized-inbound-pipeline.js';

export type ShadowComparisonStatus =
  | 'same'
  | 'legacy_only'
  | 'v2_only'
  | 'different'
  | 'both_missing'
  | 'v2_conflict';

export interface CanonicalFieldSnapshot {
  eventType: unknown;
  merchant: unknown;
  orderNumber: unknown;
  total: unknown;
  currency: unknown;
  carrier: unknown;
  trackingNumber: unknown;
  paymentStatus: unknown;
  invoiceNumber: unknown;
  paymentReference: unknown;
  products: unknown;
}

export interface ShadowFieldComparison {
  field: keyof CanonicalFieldSnapshot;
  status: ShadowComparisonStatus;
  legacy: unknown;
  v2: unknown;
}

export interface ExtractionV2ShadowComparison {
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  accuracyClaimed: false;
  legacyParserVersion: string | null;
  legacyClassification: string | null;
  legacy: CanonicalFieldSnapshot;
  v2: CanonicalFieldSnapshot;
  fields: ShadowFieldComparison[];
  summary: Record<ShadowComparisonStatus, number>;
  v2ReviewRequired: boolean;
  v2ConflictFields: string[];
  v2ValidationIssueCodes: string[];
}

function firstDefined(object: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function legacySnapshot(plan: NormalizedInboundPlan): CanonicalFieldSnapshot {
  const result = plan.validatedResult ?? plan.structuredResult;
  return {
    eventType: firstDefined(result, ['event_type']) ?? plan.classification,
    merchant: firstDefined(result, ['merchant', 'merchant_legal_name', 'seller']),
    orderNumber: firstDefined(result, ['order_number', 'orderNumber']),
    total: firstDefined(result, ['total', 'amount', 'total_amount']),
    currency: firstDefined(result, ['currency']),
    carrier: firstDefined(result, ['carrier', 'courier']),
    trackingNumber: firstDefined(result, ['tracking_number', 'trackingNumber']),
    paymentStatus: firstDefined(result, ['payment_status', 'paymentStatus']),
    invoiceNumber: firstDefined(result, ['invoice_number', 'invoiceNumber']),
    paymentReference: firstDefined(result, ['payment_reference', 'paymentReference', 'transaction_id']),
    products: firstDefined(result, ['products', 'items']),
  };
}

function valueOf<T>(field: ResolvedField<T>): T | null {
  return field.status === 'resolved' ? field.value : null;
}

function v2Snapshot(engine: ExtractionEngineV2Result): CanonicalFieldSnapshot {
  return {
    eventType: valueOf(engine.resolved.eventType),
    merchant: valueOf(engine.resolved.merchant),
    orderNumber: valueOf(engine.resolved.orderNumber),
    total: valueOf(engine.resolved.total),
    currency: valueOf(engine.resolved.currency),
    carrier: valueOf(engine.resolved.carrier),
    trackingNumber: valueOf(engine.resolved.trackingNumber),
    paymentStatus: valueOf(engine.resolved.paymentStatus),
    invoiceNumber: valueOf(engine.resolved.invoiceNumber),
    paymentReference: valueOf(engine.resolved.paymentReference),
    products: valueOf(engine.resolved.products),
  };
}

function normalizeString(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeProduct(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  const name = typeof item.name === 'string'
    ? item.name
    : typeof item.product_name === 'string'
      ? item.product_name
      : typeof item.title === 'string'
        ? item.title
        : null;
  const quantity = typeof item.quantity === 'number'
    ? item.quantity
    : typeof item.qty === 'number'
      ? item.qty
      : null;
  return {
    name: name ? normalizeString(name) : null,
    quantity,
  };
}

function normalizeComparable(field: keyof CanonicalFieldSnapshot, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (field === 'products' && Array.isArray(value)) {
    return value
      .map(normalizeProduct)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (typeof value === 'string') return normalizeString(value);
  if (typeof value === 'number') return Number(value.toFixed(6));
  return value;
}

function isMissing(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || value === '';
}

export function compareCanonicalSnapshots(input: {
  legacy: CanonicalFieldSnapshot;
  v2: CanonicalFieldSnapshot;
  v2ConflictFields?: string[];
}): ShadowFieldComparison[] {
  const fields = Object.keys(input.legacy) as Array<keyof CanonicalFieldSnapshot>;
  return fields.map((field) => {
    const legacy = input.legacy[field];
    const v2 = input.v2[field];
    const evidenceField = field === 'eventType'
      ? 'event_type'
      : field === 'orderNumber'
        ? 'order_number'
        : field === 'trackingNumber'
          ? 'tracking_number'
          : field === 'paymentStatus'
            ? 'payment_status'
            : field === 'invoiceNumber'
              ? 'invoice_number'
              : field === 'paymentReference'
                ? 'payment_reference'
                : field === 'products'
                  ? 'product'
                  : field;

    if (input.v2ConflictFields?.includes(evidenceField)) {
      return { field, status: 'v2_conflict', legacy, v2 };
    }
    if (isMissing(legacy) && isMissing(v2)) return { field, status: 'both_missing', legacy, v2 };
    if (!isMissing(legacy) && isMissing(v2)) return { field, status: 'legacy_only', legacy, v2 };
    if (isMissing(legacy) && !isMissing(v2)) return { field, status: 'v2_only', legacy, v2 };

    const same = JSON.stringify(normalizeComparable(field, legacy))
      === JSON.stringify(normalizeComparable(field, v2));
    return { field, status: same ? 'same' : 'different', legacy, v2 };
  });
}

function summarize(fields: ShadowFieldComparison[]): Record<ShadowComparisonStatus, number> {
  const summary: Record<ShadowComparisonStatus, number> = {
    same: 0,
    legacy_only: 0,
    v2_only: 0,
    different: 0,
    both_missing: 0,
    v2_conflict: 0,
  };
  for (const field of fields) summary[field.status] += 1;
  return summary;
}

/**
 * Differential-only comparison. Agreement is not ground truth and this function
 * must never be used to claim field accuracy without an independently frozen GT.
 */
export function compareLegacyAndExtractionV2(email: NormalizedEmail): ExtractionV2ShadowComparison {
  const legacyPlan = planNormalizedInboundEmail({ email });
  const engine = runExtractionEngineV2(buildEmailDocumentV1(email));
  const legacy = legacySnapshot(legacyPlan);
  const v2 = v2Snapshot(engine);
  const fields = compareCanonicalSnapshots({
    legacy,
    v2,
    v2ConflictFields: engine.resolved.conflictFields,
  });

  return {
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    accuracyClaimed: false,
    legacyParserVersion: legacyPlan.parserVersion,
    legacyClassification: legacyPlan.classification,
    legacy,
    v2,
    fields,
    summary: summarize(fields),
    v2ReviewRequired: engine.reviewRequired,
    v2ConflictFields: engine.resolved.conflictFields,
    v2ValidationIssueCodes: engine.validation.issues.map((issue) => issue.code),
  };
}
