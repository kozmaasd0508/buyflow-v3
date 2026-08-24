import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_ORDER_NUMBER_EXTRACTOR_VERSION = 'universal-order-number-v4';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function normalizeIdentifier(value: string): string | null {
  const cleaned = value.trim().replace(/^#+/, '').replace(/[.,;:)]+$/, '');
  if (cleaned.length < 4 || cleaned.length > 40 || !/\d/.test(cleaned)) return null;
  if (/https?:\/\/|www\./i.test(cleaned)) return null;
  if (/[a-z0-9-]+\.[a-z]{2,}(?:\/|$)/i.test(cleaned)) return null;
  return cleaned;
}

function key(value: string): string {
  return value.trim().toUpperCase();
}

function collectExplicit(
  text: string,
  source: 'subject' | 'body',
  confidence: number,
): EvidenceClaim<string>[] {
  const normalized = normalizeText(text);
  const patterns: Array<{ pattern: RegExp; qualifier: string }> = [
    {
      pattern: /\b(?:order|rendeles|megrendeles)(?:\s*(?:number|no\.?|nr\.?|id|szam|szama|azonosito|azonositoja|reference|ref\.?))\s*[:#-]?\s*#?([A-Z0-9][A-Z0-9._/-]{3,39})\b/gi,
      qualifier: 'explicit_order_label',
    },
    {
      pattern: /\b(?:rendelesi|megrendelesi)\s+(?:szam(?:a)?|azonosito(?:ja)?)\s*[:#-]?\s*#?([A-Z0-9][A-Z0-9._/-]{3,39})\b/gi,
      qualifier: 'explicit_order_label',
    },
    {
      pattern: /\b(?:order|rendeles|megrendeles)\s+(?:confirmation|visszaigazolas(?:a)?)\s*[:#-]?\s*#?([A-Z0-9][A-Z0-9._/-]{3,39})\b/gi,
      qualifier: 'explicit_order_confirmation_label',
    },
    {
      pattern: /\b(?:order|rendeles|megrendeles)\s*#\s*([A-Z0-9][A-Z0-9._/-]{3,39})\b/gi,
      qualifier: 'explicit_order_hash',
    },
    {
      pattern: /\b([A-Z0-9][A-Z0-9._/-]{3,39})\s+szamu\s+(?:rendeles(?:ed|e)?|megrendeles(?:ed|e)?)\b/gi,
      qualifier: 'explicit_numbered_order_phrase',
    },
    {
      pattern: /\b([A-Z]{1,10}[A-Z0-9._/-]*\d[A-Z0-9._/-]{3,39})\s+(?:rendeles|megrendeles)(?:\s*\/\s*foglalas)?\b/gi,
      qualifier: 'contextual_order_identifier',
    },
  ];

  const claims: EvidenceClaim<string>[] = [];
  for (const { pattern, qualifier } of patterns) {
    pattern.lastIndex = 0;
    for (const match of normalized.matchAll(pattern)) {
      const value = normalizeIdentifier(match[1] ?? '');
      if (!value) continue;
      claims.push({
        field: 'order_number',
        value,
        confidence: qualifier === 'contextual_order_identifier' ? confidence - 0.04 : confidence,
        source,
        extractorId: 'universal-order-number',
        extractorVersion: UNIVERSAL_ORDER_NUMBER_EXTRACTOR_VERSION,
        qualifiers: [qualifier],
      });
    }
  }
  return claims;
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
      const value = normalizeIdentifier(candidate);
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
