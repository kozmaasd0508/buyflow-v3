import { createHash } from 'node:crypto';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { runExtractionEngineV2, type ExtractionEngineV2Result } from './engine-v2.js';
import {
  evaluateBlindHoldoutV3,
  type BlindHoldoutV3Report,
  type BlindHoldoutV3TruthCase,
} from './blind-holdout-v3.js';

export const REAL_GMAIL_GROUND_TRUTH_V1_VERSION = 'real-gmail-ground-truth-v1' as const;

export interface RealGmailGroundTruthV1Case {
  /** Opaque SHA-256 id only. Raw Gmail ids/subjects/bodies must stay private. */
  caseId: string;
  document: EmailDocumentV1;
  truth: BlindHoldoutV3TruthCase;
}

export type RealGmailGroundTruthV1Report = Omit<BlindHoldoutV3Report, 'version'> & {
  version: typeof REAL_GMAIL_GROUND_TRUTH_V1_VERSION;
  datasetClass: 'development_ground_truth';
  extractionEngineVersion: 'extraction-engine-v2-shadow';
};

/**
 * Derives a repo-safe opaque id from a private runtime source key.
 * The private key itself must never be persisted in the repository/report.
 */
export function realGmailGroundTruthCaseId(privateSourceKey: string): string {
  if (!privateSourceKey.trim()) throw new Error('real_gmail_gt_private_source_key_missing');
  return createHash('sha256')
    .update(`${REAL_GMAIL_GROUND_TRUTH_V1_VERSION}\u0000${privateSourceKey}`, 'utf8')
    .digest('hex');
}

function validateCase(testCase: RealGmailGroundTruthV1Case): void {
  if (!/^[a-f0-9]{64}$/.test(testCase.caseId)) throw new Error('real_gmail_gt_case_id_must_be_opaque_sha256');
  if (testCase.truth.caseId !== testCase.caseId) throw new Error('real_gmail_gt_truth_case_id_mismatch');
}

/**
 * Privacy-safe evaluator for human-annotated real Gmail development cases.
 *
 * Raw EmailDocumentV1 content exists only for the duration of this call. The
 * returned report contains metrics/statuses plus opaque case ids; no subject,
 * body, sender, provider message id, order id or tracking id is copied into it.
 *
 * This is DEVELOPMENT ground truth, not a blind accuracy claim. Once a Gmail
 * message has been inspected while creating truth, it is permanently ineligible
 * for a future fresh blind holdout.
 */
export function evaluateRealGmailGroundTruthV1(input: {
  cases: RealGmailGroundTruthV1Case[];
  runExtraction?: (document: EmailDocumentV1) => ExtractionEngineV2Result;
}): RealGmailGroundTruthV1Report {
  if (input.cases.length === 0) throw new Error('real_gmail_gt_empty');

  const runExtraction = input.runExtraction ?? runExtractionEngineV2;
  const seen = new Set<string>();
  const truth: BlindHoldoutV3TruthCase[] = [];
  const predictions = input.cases.map((testCase) => {
    validateCase(testCase);
    if (seen.has(testCase.caseId)) throw new Error('real_gmail_gt_duplicate_case_id');
    seen.add(testCase.caseId);
    truth.push(testCase.truth);

    const result = runExtraction(testCase.document);
    if (result.productionWrites !== 0 || result.aiCalls !== 0) {
      throw new Error('real_gmail_gt_requires_zero_write_zero_ai_engine');
    }

    return {
      caseId: testCase.caseId,
      resolved: result.resolved,
    };
  });

  const base = evaluateBlindHoldoutV3({ truth, predictions });
  return {
    ...base,
    version: REAL_GMAIL_GROUND_TRUTH_V1_VERSION,
    datasetClass: 'development_ground_truth',
    extractionEngineVersion: 'extraction-engine-v2-shadow',
    productionWrites: 0,
    aiCalls: 0,
  };
}
