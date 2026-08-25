import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceCollectionResult } from './collector.js';
import { CORROBORATED_EVENT_EVIDENCE_VERSION, deriveCorroboratedEventEvidence } from './corroborated-event-evidence.js';
import { CORROBORATED_TRACKING_EVIDENCE_VERSION, deriveCorroboratedTrackingEvidence } from './corroborated-tracking-evidence.js';
import { validateResolvedCommerceEvent, type CommerceValidationResult } from './cross-field-validator.js';
import { resolveCommerceEvent } from './field-resolvers.js';
import { deriveSourceAdapterEvidence, SOURCE_ADAPTER_EVIDENCE_VERSION } from './source-adapter-evidence.js';
import { evidenceEligibleForResolution } from './source-role-eligibility.js';
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
 * independent evidence without suppressing generic claims. Collected evidence
 * can corroborate lifecycle classification, then a final read-only pass may
 * promote a unique long transport identifier to tracking only when shipment and
 * carrier evidence already agree. Source-role eligibility is applied only for
 * resolution, preserving the complete raw evidence bundle for shadow diagnostics.
 * None of these passes reads legacy output.
 */
export function runExtractionEngineV2(document: EmailDocumentV1): ExtractionEngineV2Result {
  const baseEvidence = collectUniversalCoreEvidence(document);
  const sourceAdapterClaims = deriveSourceAdapterEvidence(document);
  const evidenceWithSources = {
    claims: [...baseEvidence.bundle.claims, ...sourceAdapterClaims],
  };
  const derivedEventClaims = deriveCorroboratedEventEvidence(document, evidenceWithSources);
  const evidenceWithEvents = {
    claims: [...evidenceWithSources.claims, ...derivedEventClaims],
  };
  const derivedTrackingClaims = deriveCorroboratedTrackingEvidence(document, evidenceWithEvents);
  const evidence: EvidenceCollectionResult = {
    bundle: {
      claims: [...evidenceWithEvents.claims, ...derivedTrackingClaims],
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
      {
        id: 'corroborated-tracking-evidence',
        version: CORROBORATED_TRACKING_EVIDENCE_VERSION,
        claimCount: derivedTrackingClaims.length,
      },
    ],
  };

  const resolutionEvidence = evidenceEligibleForResolution(evidence.bundle);
  const resolved = resolveCommerceEvent(resolutionEvidence);
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
