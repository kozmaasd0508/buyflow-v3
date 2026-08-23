import type { EvidenceProduct, ResolvedCommerceEvent, ResolvedField } from './types.js';

export const BLIND_HOLDOUT_V3_VERSION = 'blind-holdout-v3';

export const BLIND_HOLDOUT_V3_FIELDS = [
  'eventType',
  'merchant',
  'orderNumber',
  'total',
  'currency',
  'carrier',
  'trackingNumber',
  'paymentStatus',
  'invoiceNumber',
  'paymentReference',
  'products',
] as const;

export type BlindHoldoutV3Field = typeof BLIND_HOLDOUT_V3_FIELDS[number];

export type GroundTruthExpectation<T> =
  | { state: 'known'; value: T }
  | { state: 'not_applicable' }
  | { state: 'unknown' };

export interface BlindHoldoutV3Fields {
  eventType: GroundTruthExpectation<string>;
  merchant: GroundTruthExpectation<string>;
  orderNumber: GroundTruthExpectation<string>;
  total: GroundTruthExpectation<number>;
  currency: GroundTruthExpectation<string>;
  carrier: GroundTruthExpectation<string>;
  trackingNumber: GroundTruthExpectation<string>;
  paymentStatus: GroundTruthExpectation<string>;
  invoiceNumber: GroundTruthExpectation<string>;
  paymentReference: GroundTruthExpectation<string>;
  products: GroundTruthExpectation<EvidenceProduct[]>;
}

export interface BlindHoldoutV3TruthCase {
  /** Opaque/hash-like identifier. Do not store raw subject/body here. */
  caseId: string;
  isCommerceEvent: boolean;
  fields: BlindHoldoutV3Fields;
}

export interface BlindHoldoutV3PredictionCase {
  caseId: string;
  resolved: ResolvedCommerceEvent;
}

export interface BinaryMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
}

export interface BlindHoldoutV3FieldMetrics {
  known: number;
  notApplicable: number;
  unknown: number;
  exactMatches: number;
  mismatches: number;
  missing: number;
  conflicts: number;
  falsePositives: number;
  truePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  exactMatchRate: number | null;
}

export interface BlindHoldoutV3CaseResult {
  caseId: string;
  truthCommerce: boolean;
  detectedCommerce: boolean;
  reviewRequired: boolean;
  criticalMismatch: boolean;
  fieldResults: Record<BlindHoldoutV3Field, {
    truthState: GroundTruthExpectation<unknown>['state'];
    actualStatus: ResolvedField<unknown>['status'];
    exact: boolean | null;
  }>;
}

export interface BlindHoldoutV3Report {
  version: typeof BLIND_HOLDOUT_V3_VERSION;
  mode: 'evaluation';
  productionWrites: 0;
  aiCalls: 0;
  cases: number;
  detection: BinaryMetrics;
  fields: Record<BlindHoldoutV3Field, BlindHoldoutV3FieldMetrics>;
  reviewRequiredCount: number;
  criticalMismatchCount: number;
  rows: BlindHoldoutV3CaseResult[];
}

const CRITICAL_FIELDS = new Set<BlindHoldoutV3Field>([
  'eventType',
  'orderNumber',
  'total',
  'currency',
  'carrier',
  'trackingNumber',
  'paymentStatus',
  'invoiceNumber',
  'paymentReference',
]);

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function normalizeString(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'string') return normalizeString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function equivalent(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) < 0.000001;
  }
  return JSON.stringify(canonicalize(actual)) === JSON.stringify(canonicalize(expected));
}

function actualField(resolved: ResolvedCommerceEvent, field: BlindHoldoutV3Field): ResolvedField<unknown> {
  return resolved[field] as ResolvedField<unknown>;
}

function emptyFieldMetrics(): BlindHoldoutV3FieldMetrics {
  return {
    known: 0,
    notApplicable: 0,
    unknown: 0,
    exactMatches: 0,
    mismatches: 0,
    missing: 0,
    conflicts: 0,
    falsePositives: 0,
    truePositives: 0,
    falseNegatives: 0,
    precision: null,
    recall: null,
    exactMatchRate: null,
  };
}

export function evaluateBlindHoldoutV3(input: {
  truth: BlindHoldoutV3TruthCase[];
  predictions: BlindHoldoutV3PredictionCase[];
}): BlindHoldoutV3Report {
  const predictionById = new Map(input.predictions.map((prediction) => [prediction.caseId, prediction.resolved]));
  if (predictionById.size !== input.predictions.length) {
    throw new Error('blind_holdout_v3_duplicate_prediction_case_id');
  }

  const truthIds = new Set<string>();
  for (const truthCase of input.truth) {
    if (truthIds.has(truthCase.caseId)) throw new Error('blind_holdout_v3_duplicate_truth_case_id');
    truthIds.add(truthCase.caseId);
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let reviewRequiredCount = 0;
  let criticalMismatchCount = 0;

  const fields = Object.fromEntries(
    BLIND_HOLDOUT_V3_FIELDS.map((field) => [field, emptyFieldMetrics()]),
  ) as Record<BlindHoldoutV3Field, BlindHoldoutV3FieldMetrics>;

  const rows: BlindHoldoutV3CaseResult[] = [];

  for (const truthCase of input.truth) {
    const resolved = predictionById.get(truthCase.caseId);
    if (!resolved) throw new Error(`blind_holdout_v3_missing_prediction:${truthCase.caseId}`);

    const detectedCommerce = resolved.eventType.status === 'resolved' && resolved.eventType.value !== null;
    if (truthCase.isCommerceEvent && detectedCommerce) tp += 1;
    else if (truthCase.isCommerceEvent) fn += 1;
    else if (detectedCommerce) fp += 1;
    else tn += 1;

    if (resolved.reviewRequired) reviewRequiredCount += 1;

    let criticalMismatch = false;
    const fieldResults = {} as BlindHoldoutV3CaseResult['fieldResults'];

    for (const field of BLIND_HOLDOUT_V3_FIELDS) {
      const truth = truthCase.fields[field] as GroundTruthExpectation<unknown>;
      const actual = actualField(resolved, field);
      const metric = fields[field];
      let exact: boolean | null = null;

      if (truth.state === 'unknown') {
        metric.unknown += 1;
      } else if (truth.state === 'not_applicable') {
        metric.notApplicable += 1;
        if (actual.status === 'resolved' && actual.value !== null) {
          metric.falsePositives += 1;
          if (CRITICAL_FIELDS.has(field)) criticalMismatch = true;
        } else if (actual.status === 'conflict') {
          metric.conflicts += 1;
          if (CRITICAL_FIELDS.has(field)) criticalMismatch = true;
        }
      } else {
        metric.known += 1;
        if (actual.status === 'resolved' && actual.value !== null) {
          exact = equivalent(actual.value, truth.value);
          if (exact) {
            metric.exactMatches += 1;
            metric.truePositives += 1;
          } else {
            metric.mismatches += 1;
            metric.falsePositives += 1;
            metric.falseNegatives += 1;
            if (CRITICAL_FIELDS.has(field)) criticalMismatch = true;
          }
        } else if (actual.status === 'conflict') {
          metric.conflicts += 1;
          metric.falseNegatives += 1;
          if (CRITICAL_FIELDS.has(field)) criticalMismatch = true;
        } else {
          metric.missing += 1;
          metric.falseNegatives += 1;
          if (CRITICAL_FIELDS.has(field)) criticalMismatch = true;
        }
      }

      fieldResults[field] = {
        truthState: truth.state,
        actualStatus: actual.status,
        exact,
      };
    }

    if (criticalMismatch) criticalMismatchCount += 1;
    rows.push({
      caseId: truthCase.caseId,
      truthCommerce: truthCase.isCommerceEvent,
      detectedCommerce,
      reviewRequired: resolved.reviewRequired,
      criticalMismatch,
      fieldResults,
    });
  }

  for (const field of BLIND_HOLDOUT_V3_FIELDS) {
    const metric = fields[field];
    metric.precision = ratio(metric.truePositives, metric.truePositives + metric.falsePositives);
    metric.recall = ratio(metric.truePositives, metric.truePositives + metric.falseNegatives);
    metric.exactMatchRate = ratio(metric.exactMatches, metric.known);
  }

  return {
    version: BLIND_HOLDOUT_V3_VERSION,
    mode: 'evaluation',
    productionWrites: 0,
    aiCalls: 0,
    cases: input.truth.length,
    detection: {
      tp,
      fp,
      fn,
      tn,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
    },
    fields,
    reviewRequiredCount,
    criticalMismatchCount,
    rows,
  };
}
