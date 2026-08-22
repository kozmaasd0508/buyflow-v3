import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectEvidence, type EvidenceCollectionResult, type EvidenceExtractor } from './collector.js';
import { universalMoneyExtractor } from './money-extractor.js';
import { universalOrderNumberExtractor } from './order-number-extractor.js';
import { universalTrackingNumberExtractor } from './tracking-number-extractor.js';

export const UNIVERSAL_CORE_EXTRACTORS: EvidenceExtractor[] = [
  universalOrderNumberExtractor,
  universalTrackingNumberExtractor,
  universalMoneyExtractor,
];

export function collectUniversalCoreEvidence(document: EmailDocumentV1): EvidenceCollectionResult {
  return collectEvidence(document, UNIVERSAL_CORE_EXTRACTORS);
}
