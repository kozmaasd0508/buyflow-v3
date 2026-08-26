import type { BlindHoldoutV3Field, GroundTruthExpectation } from './blind-holdout-v3.js';
import { runExtractionEngineV2 } from './engine-v2.js';
import type { RealGmailGroundTruthV1Case } from './real-gmail-ground-truth-v1.js';
import {
  collectTechnicalEvidenceV1,
  summarizeTechnicalEvidenceV1,
  type TechnicalEvidence,
  type TechnicalEvidenceKind,
} from './technical-evidence-v1.js';

export const TECHNICAL_EVIDENCE_REAL_GMAIL_MEASUREMENT_V1 = 'technical-evidence-real-gmail-measurement-v1' as const;

const FIELD_KIND: Partial<Record<BlindHoldoutV3Field, TechnicalEvidenceKind>> = {
  eventType: 'event',
  merchant: 'merchant',
  orderNumber: 'order_number',
  total: 'amount',
  currency: 'currency',
  carrier: 'carrier',
  trackingNumber: 'tracking_number',
  invoiceNumber: 'invoice_number',
  paymentReference: 'payment_reference',
};

export interface TechnicalEvidenceFieldMeasurementV1 {
  knownTruth: number;
  exactSupport: number;
  contradictorySupport: number;
  baselineMissingOrConflict: number;
  technicalRescue: number;
}

export interface TechnicalEvidenceRealGmailCaseV1 {
  caseId: string;
  truthCommerce: boolean;
  baselineReviewRequired: boolean;
  technicalEvidenceCount: number;
  technicalSources: string[];
  identifierKindsPresent: string[];
  exactSupportedFields: BlindHoldoutV3Field[];
  contradictoryFields: BlindHoldoutV3Field[];
  rescuedBaselineFields: BlindHoldoutV3Field[];
}

export interface TechnicalEvidenceRealGmailMeasurementV1Report {
  version: typeof TECHNICAL_EVIDENCE_REAL_GMAIL_MEASUREMENT_V1;
  datasetClass: 'development_ground_truth';
  mode: 'shadow-measurement';
  productionWrites: 0;
  aiCalls: 0;
  cases: number;
  casesWithAnyTechnicalEvidence: number;
  casesWithCommerceTechnicalEvidence: number;
  casesWithIdentifierEvidence: number;
  casesWithTechnicalRescue: number;
  fields: Partial<Record<BlindHoldoutV3Field, TechnicalEvidenceFieldMeasurementV1>>;
  rows: TechnicalEvidenceRealGmailCaseV1[];
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^#/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? '').replace(/\s+/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceMatchesTruth(row: TechnicalEvidence, expected: unknown): boolean {
  const actual = row.normalizedValue ?? row.rawValue;
  if (typeof expected === 'number') {
    const numeric = normalizeNumeric(actual);
    return numeric !== null && Math.abs(numeric - expected) < 0.000001;
  }
  return normalizeText(actual) === normalizeText(expected);
}

function baselineMatchesTruth(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'number') {
    const numeric = normalizeNumeric(actual);
    return numeric !== null && Math.abs(numeric - expected) < 0.000001;
  }
  return normalizeText(actual) === normalizeText(expected);
}

function emptyField(): TechnicalEvidenceFieldMeasurementV1 {
  return {
    knownTruth: 0,
    exactSupport: 0,
    contradictorySupport: 0,
    baselineMissingOrConflict: 0,
    technicalRescue: 0,
  };
}

function knownValue(expectation: GroundTruthExpectation<unknown>): unknown | undefined {
  return expectation.state === 'known' ? expectation.value : undefined;
}

/**
 * Side-by-side DEVELOPMENT measurement only.
 *
 * It compares frozen Extraction Engine v2 output and independent TechnicalEvidence
 * v1 support against the same human truth. Raw message content and raw evidence
 * values never enter the returned report; only opaque case ids and aggregate
 * statuses are returned.
 */
export function measureTechnicalEvidenceOnRealGmailV1(input: {
  cases: RealGmailGroundTruthV1Case[];
}): TechnicalEvidenceRealGmailMeasurementV1Report {
  if (input.cases.length === 0) throw new Error('technical_evidence_real_gmail_empty');

  const fields: Partial<Record<BlindHoldoutV3Field, TechnicalEvidenceFieldMeasurementV1>> = {};
  const rows: TechnicalEvidenceRealGmailCaseV1[] = [];
  let casesWithAnyTechnicalEvidence = 0;
  let casesWithCommerceTechnicalEvidence = 0;
  let casesWithIdentifierEvidence = 0;
  let casesWithTechnicalRescue = 0;

  for (const testCase of input.cases) {
    const baseline = runExtractionEngineV2(testCase.document);
    const technical = collectTechnicalEvidenceV1(testCase.document);
    if (baseline.productionWrites !== 0 || baseline.aiCalls !== 0 || technical.productionWrites !== 0 || technical.aiCalls !== 0) {
      throw new Error('technical_evidence_real_gmail_requires_zero_write_zero_ai');
    }

    const summary = summarizeTechnicalEvidenceV1(technical);
    if (summary.evidenceCount > 0) casesWithAnyTechnicalEvidence += 1;
    if (technical.evidence.some((row) => row.kind !== 'raw_signal' && row.kind !== 'platform')) {
      casesWithCommerceTechnicalEvidence += 1;
    }
    if (summary.identifierKindsPresent.length > 0) casesWithIdentifierEvidence += 1;

    const exactSupportedFields: BlindHoldoutV3Field[] = [];
    const contradictoryFields: BlindHoldoutV3Field[] = [];
    const rescuedBaselineFields: BlindHoldoutV3Field[] = [];

    for (const [field, kind] of Object.entries(FIELD_KIND) as Array<[BlindHoldoutV3Field, TechnicalEvidenceKind]>) {
      const expectation = testCase.truth.fields[field] as GroundTruthExpectation<unknown>;
      const expected = knownValue(expectation);
      if (expected === undefined) continue;

      const metric = fields[field] ?? (fields[field] = emptyField());
      metric.knownTruth += 1;

      const candidates = technical.evidence.filter((row) => row.kind === kind);
      const hasExact = candidates.some((row) => evidenceMatchesTruth(row, expected));
      const hasContradiction = candidates.length > 0 && !hasExact;
      if (hasExact) {
        metric.exactSupport += 1;
        exactSupportedFields.push(field);
      }
      if (hasContradiction) {
        metric.contradictorySupport += 1;
        contradictoryFields.push(field);
      }

      const baselineField = baseline.resolved[field];
      const baselineMissingOrConflict = baselineField.status !== 'resolved'
        || !baselineMatchesTruth(baselineField.value, expected);
      if (baselineMissingOrConflict) metric.baselineMissingOrConflict += 1;
      if (baselineMissingOrConflict && hasExact) {
        metric.technicalRescue += 1;
        rescuedBaselineFields.push(field);
      }
    }

    if (rescuedBaselineFields.length > 0) casesWithTechnicalRescue += 1;
    rows.push({
      caseId: testCase.caseId,
      truthCommerce: testCase.truth.isCommerceEvent,
      baselineReviewRequired: baseline.reviewRequired,
      technicalEvidenceCount: summary.evidenceCount,
      technicalSources: Object.keys(summary.bySource).sort(),
      identifierKindsPresent: [...summary.identifierKindsPresent],
      exactSupportedFields,
      contradictoryFields,
      rescuedBaselineFields,
    });
  }

  return {
    version: TECHNICAL_EVIDENCE_REAL_GMAIL_MEASUREMENT_V1,
    datasetClass: 'development_ground_truth',
    mode: 'shadow-measurement',
    productionWrites: 0,
    aiCalls: 0,
    cases: input.cases.length,
    casesWithAnyTechnicalEvidence,
    casesWithCommerceTechnicalEvidence,
    casesWithIdentifierEvidence,
    casesWithTechnicalRescue,
    fields,
    rows,
  };
}
