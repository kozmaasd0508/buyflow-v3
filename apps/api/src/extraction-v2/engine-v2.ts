import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceCollectionResult } from './collector.js';
import { CORROBORATED_EVENT_EVIDENCE_VERSION, deriveCorroboratedEventEvidence } from './corroborated-event-evidence.js';
import { validateResolvedCommerceEvent, type CommerceValidationResult } from './cross-field-validator.js';
import { resolveCommerceEvent } from './field-resolvers.js';
import { deriveSourceAdapterEvidence, SOURCE_ADAPTER_EVIDENCE_VERSION } from './source-adapter-evidence.js';
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
 * Universal extraction always runs first. Additive source adapters may then add
 * independent evidence without suppressing generic claims. Finally, already
 * collected evidence may corroborate lifecycle classification. Neither pass
 * reads legacy parser output.
 */
export function runExtractionEngineV2(document: EmailDocumentV1): ExtractionEngineV2Result {
  const baseEvidence = collectUniversalCoreEvidence(document);
  const sourceAdapterClaims = deriveSourceAdapterEvidence(document);
  const evidenceWithSources = {
    claims: [...baseEvidence.bundle.claims, ...sourceAdapterClaims],
  };
  const derivedEventClaims = deriveCorroboratedEventEvidence(document, evidenceWithSources);
  const evidence: EvidenceCollectionResult = {
    bundle: {
      claims: [...evidenceWithSources.claims, ...derivedEventClaims],
    },
    ranExtractors: [
      ...baseEvidence.ranExtractors,
      {
        id: 'source-adapter-evidence',
        version: SOURCE_ADAPTER_EVIDENCE_VERSION,
        claimCount: sourceAdapterClaims.length,
      },
      {
        id: 'corroborated-event-evidence',
        version: CORROBORATED_EVENT_EVIDENCE_VERSION,
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
