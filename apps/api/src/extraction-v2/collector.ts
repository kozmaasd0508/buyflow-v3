import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceBundle, EvidenceClaim } from './types.js';

export interface EvidenceExtractor {
  id: string;
  version: string;
  extract(document: EmailDocumentV1): EvidenceClaim[];
}

export interface EvidenceCollectionResult {
  bundle: EvidenceBundle;
  ranExtractors: Array<{ id: string; version: string; claimCount: number }>;
}

/**
 * Runs every extractor. There is intentionally no first-match/early-return path.
 * Provider- or merchant-aware extractors can add claims but cannot suppress the
 * generic extractors that follow them.
 */
export function collectEvidence(
  document: EmailDocumentV1,
  extractors: EvidenceExtractor[],
): EvidenceCollectionResult {
  const claims: EvidenceClaim[] = [];
  const ranExtractors: EvidenceCollectionResult['ranExtractors'] = [];

  for (const extractor of extractors) {
    const emitted = extractor.extract(document);
    claims.push(...emitted);
    ranExtractors.push({
      id: extractor.id,
      version: extractor.version,
      claimCount: emitted.length,
    });
  }

  return {
    bundle: { claims },
    ranExtractors,
  };
}
