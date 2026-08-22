import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceCollectionResult } from './collector.js';
import { deriveCorroboratedEventEvidence } from './corroborated-event-evidence.js';
import { validateResolvedCommerceEvent, type CommerceValidationResult } from './cross-field-validator.js';
import { resolveCommerceEvent } from './field-resolvers.js';
import type { ResolvedCommerceEvent } from './types.js';
import { collectUniversalCoreEvidence } from './universal-core.js';

export interface ExtractionEngineV2Result {
  engineVersion: 'extraction-engine-v2-shadow';
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: EvidenceCollectionResult;
  resolved: ResolvedCommerceEvent;
  validation: CommerceValidationResult;
  reviewRequired: boolean;
}

/**
 * Pure shadow orchestration for Extraction Engine v2.
 * No database writes, no AI calls, no mutation of the legacy parser path.
 *
 * Event classification has a conservative second pass: already-collected
 * independent field evidence may add corroborated lifecycle evidence, but it
 * cannot suppress any extractor and it does not use the legacy parser result.
 */
export function runExtractionEngineV2(document: EmailDocumentV1): ExtractionEngineV2Result {
  const baseEvidence = collectUniversalCoreEvidence(document);
  const derivedEventClaims = deriveCorroboratedEventEvidence(document, baseEvidence.bundle);
  const evidence: EvidenceCollectionResult = {
    bundle: {
      claims: [...baseEvidence.bundle.claims, ...derivedEventClaims],
    },
    ranExtractors: [
      ...baseEvidence.ranExtractors,
      {
        id: 'corroborated-event-evidence',
        version: 'corroborated-event-evidence-v1',
        claimCount: derivedEventClaims.length,
      },
    ],
  };

  const resolved = resolveCommerceEvent(evidence.bundle);
  const validation = validateResolvedCommerceEvent(resolved);

  return {
    engineVersion: 'extraction-engine-v2-shadow',
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
    resolved,
    validation,
    reviewRequired: resolved.reviewRequired || validation.reviewRequired,
  };
}
