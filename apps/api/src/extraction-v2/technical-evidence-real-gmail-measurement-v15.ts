import type { BlindHoldoutV3Field, GroundTruthExpectation } from './blind-holdout-v3.js';
import { runExtractionEngineV2 } from './engine-v2.js';
import type { RealGmailGroundTruthV1Case } from './real-gmail-ground-truth-v1.js';
import {
  collectTechnicalEvidenceV15,
  summarizeTechnicalEvidenceV15,
  TECHNICAL_EVIDENCE_V15_VERSION,
  type TechnicalEvidencePdfAttachmentV15,
  type TechnicalEvidenceV15,
  type TechnicalEvidenceV15Kind,
} from './technical-evidence-v1-5.js';

export const TECHNICAL_EVIDENCE_REAL_GMAIL_MEASUREMENT_V15 = 'technical-evidence-real-gmail-measurement-v1.5' as const;

const FIELD_KIND: Partial<Record<BlindHoldoutV3Field, TechnicalEvidenceV15Kind>> = {
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

export interface TechnicalEvidenceRealGmailV15Case extends RealGmailGroundTruthV1Case {
  /** Optional already-extracted local PDF text. Raw PDF bytes never enter the report. */
  pdfAttachments?: TechnicalEvidencePdfAttachmentV15[];
}

export interface TechnicalEvidenceFieldMeasurementV15 {
  knownTruth: number;
  exactSupport: number;
  contradictorySupport: number;
  baselineMissingOrConflict: number;
  technicalRescue: number;
}

export interface TechnicalEvidenceRealGmailCaseV15 {
  caseId: string;
  truthCommerce: boolean;
  baselineReviewRequired: boolean;
  technicalEvidenceCount: number;
  technicalSources: string[];
  identifierKindsPresent: string[];
  namespacesPresent: string[];
  exactSupportedFields: BlindHoldoutV3Field[];
  contradictoryFields: BlindHoldoutV3Field[];
  rescuedBaselineFields: BlindHoldoutV3Field[];
}

export interface TechnicalEvidenceRealGmailMeasurementV15Report {
  version: typeof TECHNICAL_EVIDENCE_REAL_GMAIL_MEASUREMENT_V15;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V15_VERSION;
  datasetClass: 'development_ground_truth';
  mode: 'shadow-measurement';
  productionWrites: 0;
  aiCalls: 0;
  cases: number;
  casesWithAnyTechnicalEvidence: number;
  casesWithCommerceTechnicalEvidence: number;
  casesWithIdentifierEvidence: number;
  casesWithTechnicalRescue: number;
  fields: Partial<Record<BlindHoldoutV3Field, TechnicalEvidenceFieldMeasurementV15>>;
  rows: TechnicalEvidenceRealGmailCaseV15[];
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

function evidenceMatchesTruth(row: TechnicalEvidenceV15, expected: unknown): boolean {
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

function emptyField(): TechnicalEvidenceFieldMeasurementV15 {
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
 * Privacy-safe v1.5 measurement over private Gmail EmailDocument input.
 * Returned rows contain opaque case ids and aggregate statuses only; raw mail,
 * field values and evidence values never leave this function.
 */
export function measureTechnicalEvidenceOnRealGmailV15(input: {
  cases: TechnicalEvidenceRealGmailV15Case[];
}): TechnicalEvidenceRealGmailMeasurementV15Report {
  if (input.cases.length === 0) throw new Error('technical_evidence_real_gmail_v15_empty');

  const fields: Partial<Record<BlindHoldoutV3Field, TechnicalEvidenceFieldMeasurementV15>> = {};
  const rows: TechnicalEvidenceRealGmailCaseV15[] = [];
  let casesWithAnyTechnicalEvidence = 0;
  let casesWithCommerceTechnicalEvidence = 0;
  let casesWithIdentifierEvidence = 0;
  let casesWithTechnicalRescue = 0;

  for (const testCase of input.cases) {
    const baseline = runExtractionEngineV2(testCase.document);
    const technical = collectTechnicalEvidenceV15({
      document: testCase.document,
      pdfAttachments: testCase.pdfAttachments,
    });
    if (baseline.productionWrites !== 0 || baseline.aiCalls !== 0 || technical.productionWrites !== 0 || technical.aiCalls !== 0) {
      throw new Error('technical_evidence_real_gmail_v15_requires_zero_write_zero_ai');
    }

    const summary = summarizeTechnicalEvidenceV15(technical, testCase.pdfAttachments?.length ?? 0);
    if (summary.evidenceCount > 0) casesWithAnyTechnicalEvidence += 1;
    if (technical.evidence.some((row) => row.kind !== 'raw_signal' && row.kind !== 'platform')) {
      casesWithCommerceTechnicalEvidence += 1;
    }
    if (summary.identifierKindsPresent.length > 0) casesWithIdentifierEvidence += 1;

    const exactSupportedFields: BlindHoldoutV3Field[] = [];
    const contradictoryFields: BlindHoldoutV3Field[] = [];
    const rescuedBaselineFields: BlindHoldoutV3Field[] = [];

    for (const [field, kind] of Object.entries(FIELD_KIND) as Array<[BlindHoldoutV3Field, TechnicalEvidenceV15Kind]>) {
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
      namespacesPresent: [...summary.namespacesPresent],
      exactSupportedFields,
      contradictoryFields,
      rescuedBaselineFields,
    });
  }

  return {
    version: TECHNICAL_EVIDENCE_REAL_GMAIL_MEASUREMENT_V15,
    collectorVersion: TECHNICAL_EVIDENCE_V15_VERSION,
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
