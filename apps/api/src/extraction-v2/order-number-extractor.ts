import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import {
  extractUniversalOrderIdentityV2,
  normalizeUniversalOrderIdentifierV2,
  UNIVERSAL_ORDER_IDENTITY_V2_VERSION,
} from '../ingestion/universal-order-identity-v2.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_ORDER_NUMBER_EXTRACTOR_VERSION = 'universal-order-number-v5';

function key(value: string): string {
  return value.trim().toUpperCase();
}

function collectExplicit(
  text: string,
  source: 'subject' | 'body',
  confidenceCap: number,
): EvidenceClaim<string>[] {
  return extractUniversalOrderIdentityV2(text).map((match) => ({
    field: 'order_number',
    value: match.value,
    confidence: Math.min(confidenceCap, match.confidence),
    source,
    extractorId: 'universal-order-number',
    extractorVersion: UNIVERSAL_ORDER_NUMBER_EXTRACTOR_VERSION,
    qualifiers: [match.qualifier, UNIVERSAL_ORDER_IDENTITY_V2_VERSION],
  }));
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const claim of claims) {
    const claimKey = key(claim.value);
    const current = best.get(claimKey);
    if (!current || claim.confidence > current.confidence) best.set(claimKey, claim);
  }
  return [...best.values()];
}

export const universalOrderNumberExtractor: EvidenceExtractor = {
  id: 'universal-order-number',
  version: UNIVERSAL_ORDER_NUMBER_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims: EvidenceClaim<string>[] = [
      ...collectExplicit(document.subject ?? '', 'subject', 0.99),
      ...collectExplicit(document.text, 'body', 0.98),
    ];

    for (const candidate of document.signals.orderNumbers) {
      const value = normalizeUniversalOrderIdentifierV2(candidate);
      if (!value) continue;
      claims.push({
        field: 'order_number',
        value,
        confidence: 0.82,
        source: 'document_structure',
        extractorId: 'universal-order-number',
        extractorVersion: UNIVERSAL_ORDER_NUMBER_EXTRACTOR_VERSION,
        qualifiers: ['document_order_candidate'],
      });
    }

    return dedupe(claims);
  },
};
