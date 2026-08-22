import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_TRACKING_EXTRACTOR_VERSION = 'universal-tracking-number-v2';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function normalizeTracking(value: string): string | null {
  const cleaned = value.trim().replace(/^#+/, '').replace(/[.,;:)]+$/, '').toUpperCase();
  if (cleaned.length < 8 || cleaned.length > 32 || !/\d/.test(cleaned)) return null;
  if (!/^[A-Z0-9-]+$/.test(cleaned)) return null;
  return cleaned;
}

function collectExplicit(
  text: string,
  source: 'subject' | 'body',
  confidence: number,
): EvidenceClaim<string>[] {
  const normalized = normalizeText(text);
  const patterns: Array<{ pattern: RegExp; qualifier: string }> = [
    {
      pattern: /\b(?:tracking(?:\s*(?:number|no\.?|id))?|nyomkovetesi\s*(?:szam|szama|azonosito|azonositoja)|kuldemeny\s*(?:szam|szama|azonosito|azonositoja)|csomag\s*(?:szam|szama|azonosito|azonositoja)|parcel(?:\s*(?:number|no\.?|id))|shipment(?:\s*(?:number|no\.?|id)))\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,31})\b/gi,
      qualifier: 'explicit_tracking_label',
    },
    {
      pattern: /\b([A-Z0-9][A-Z0-9-]{7,31})\s+(?:szamu\s+)?(?:csomag|kuldemeny)\b/gi,
      qualifier: 'contextual_tracking_identifier',
    },
  ];

  const claims: EvidenceClaim<string>[] = [];
  for (const { pattern, qualifier } of patterns) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const value = normalizeTracking(match[1] ?? '');
      if (!value) continue;
      claims.push({
        field: 'tracking_number',
        value,
        confidence: qualifier === 'contextual_tracking_identifier' ? confidence - 0.05 : confidence,
        source,
        extractorId: 'universal-tracking-number',
        extractorVersion: UNIVERSAL_TRACKING_EXTRACTOR_VERSION,
        qualifiers: [qualifier],
      });
    }
  }
  return claims;
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const claim of claims) {
    const current = best.get(claim.value);
    if (!current || claim.confidence > current.confidence) best.set(claim.value, claim);
  }
  return [...best.values()];
}

export const universalTrackingNumberExtractor: EvidenceExtractor = {
  id: 'universal-tracking-number',
  version: UNIVERSAL_TRACKING_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims: EvidenceClaim<string>[] = [
      ...collectExplicit(document.subject ?? '', 'subject', 0.99),
      ...collectExplicit(document.text, 'body', 0.98),
    ];

    for (const candidate of document.signals.trackingNumbers) {
      const value = normalizeTracking(candidate);
      if (!value) continue;
      claims.push({
        field: 'tracking_number',
        value,
        confidence: 0.84,
        source: 'document_structure',
        extractorId: 'universal-tracking-number',
        extractorVersion: UNIVERSAL_TRACKING_EXTRACTOR_VERSION,
        qualifiers: ['document_tracking_candidate'],
      });
    }

    return dedupe(claims);
  },
};
