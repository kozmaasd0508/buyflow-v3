import { createHash } from 'node:crypto';
import {
  BLIND_HOLDOUT_V3_FIELDS,
  BLIND_HOLDOUT_V3_VERSION,
  type BlindHoldoutV3Field,
  type BlindHoldoutV3TruthCase,
  type GroundTruthExpectation,
} from './blind-holdout-v3.js';

export const BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT = 'e871ce25a842d061f55d359f017fe4fa14dd8f61';
export const BLIND_HOLDOUT_V3_SELECTION_CUTOFF = '2026-08-22T22:04:05.000Z';

const EVENT_TYPES = new Set([
  'order_created',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'payment_completed',
  'refund',
  'return',
  'cancellation',
]);

const PAYMENT_STATUSES = new Set([
  'paid',
  'cash_on_delivery',
  'failed',
  'refunded',
]);

export interface BlindHoldoutV3FreezeBundle {
  version: typeof BLIND_HOLDOUT_V3_VERSION;
  candidateFreezeCommit: typeof BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT;
  selectionCutoff: typeof BLIND_HOLDOUT_V3_SELECTION_CUTOFF;
  truth: BlindHoldoutV3TruthCase[];
}

export interface BlindHoldoutV3FrozenTruth {
  bundle: BlindHoldoutV3FreezeBundle;
  canonicalJson: string;
  truthSha256: string;
}

export function blindHoldoutV3CaseId(userId: string, providerMessageId: string): string {
  if (!userId.trim() || !providerMessageId.trim()) throw new Error('blind_v3_case_id_input_missing');
  return createHash('sha256')
    .update(`blind-holdout-v3\u0000${userId}\u0000${providerMessageId}`, 'utf8')
    .digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validProduct(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  for (const key of ['quantity', 'unitPrice', 'totalPrice'] as const) {
    const child = value[key];
    if (child !== null && child !== undefined && (typeof child !== 'number' || !Number.isFinite(child))) return false;
  }
  const currency = value.currency;
  if (currency !== null && currency !== undefined && typeof currency !== 'string') return false;
  return true;
}

function validKnownValue(field: BlindHoldoutV3Field, value: unknown): boolean {
  if (field === 'total') return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (field === 'products') return Array.isArray(value) && value.every(validProduct);
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  if (field === 'eventType') return EVENT_TYPES.has(value);
  if (field === 'paymentStatus') return PAYMENT_STATUSES.has(value);
  return true;
}

function validateExpectation(field: BlindHoldoutV3Field, value: unknown): asserts value is GroundTruthExpectation<unknown> {
  if (!isPlainObject(value)) throw new Error(`blind_v3_invalid_expectation:${field}`);
  if (!['known', 'not_applicable', 'unknown'].includes(String(value.state))) {
    throw new Error(`blind_v3_invalid_expectation_state:${field}`);
  }
  if (value.state === 'known' && !validKnownValue(field, value.value)) {
    throw new Error(`blind_v3_invalid_known_value:${field}`);
  }
}

function validateCase(input: unknown): asserts input is BlindHoldoutV3TruthCase {
  if (!isPlainObject(input)) throw new Error('blind_v3_invalid_case');
  if (typeof input.caseId !== 'string' || !/^[a-f0-9]{64}$/.test(input.caseId)) {
    throw new Error('blind_v3_invalid_case_id');
  }
  if (typeof input.isCommerceEvent !== 'boolean') throw new Error('blind_v3_invalid_commerce_flag');
  if (!isPlainObject(input.fields)) throw new Error('blind_v3_invalid_fields');
  for (const field of BLIND_HOLDOUT_V3_FIELDS) validateExpectation(field, input.fields[field]);
}

function normalizedCase(input: BlindHoldoutV3TruthCase): BlindHoldoutV3TruthCase {
  const fields = {} as BlindHoldoutV3TruthCase['fields'];
  for (const field of BLIND_HOLDOUT_V3_FIELDS) {
    const expectation = input.fields[field] as GroundTruthExpectation<unknown>;
    if (expectation.state === 'known') {
      const knownValue = typeof expectation.value === 'string' ? expectation.value.trim() : expectation.value;
      (fields as Record<string, GroundTruthExpectation<unknown>>)[field] = { state: 'known', value: knownValue };
    } else {
      (fields as Record<string, GroundTruthExpectation<unknown>>)[field] = { state: expectation.state };
    }
  }
  return {
    caseId: input.caseId,
    isCommerceEvent: input.isCommerceEvent,
    fields,
  };
}

function stableCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCanonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableCanonicalize(value[key])]),
  );
}

export function freezeBlindHoldoutV3Truth(truthInput: unknown): BlindHoldoutV3FrozenTruth {
  if (!Array.isArray(truthInput) || truthInput.length === 0) throw new Error('blind_v3_truth_empty');

  const seen = new Set<string>();
  const truth = truthInput.map((value) => {
    validateCase(value);
    if (seen.has(value.caseId)) throw new Error('blind_v3_duplicate_truth_case_id');
    seen.add(value.caseId);
    return normalizedCase(value);
  }).sort((a, b) => a.caseId.localeCompare(b.caseId));

  const bundle: BlindHoldoutV3FreezeBundle = {
    version: BLIND_HOLDOUT_V3_VERSION,
    candidateFreezeCommit: BLIND_HOLDOUT_V3_CANDIDATE_FREEZE_COMMIT,
    selectionCutoff: BLIND_HOLDOUT_V3_SELECTION_CUTOFF,
    truth,
  };
  const canonicalJson = JSON.stringify(stableCanonicalize(bundle));
  const truthSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return { bundle, canonicalJson, truthSha256 };
}
