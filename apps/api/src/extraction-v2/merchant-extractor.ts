import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_MERCHANT_EXTRACTOR_VERSION = 'universal-merchant-v2';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function cleanMerchant(value: string): string | null {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/^["'“”„]+|["'“”„]+$/g, '')
    .replace(/[|;,]+$/, '')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 120) return null;
  if (/@|https?:\/\//i.test(cleaned)) return null;
  const normalized = normalizeText(cleaned).trim().toLowerCase();
  if (/^(?:no-?reply|noreply|info|support|customer service|ugyfelszolgalat|webshop|shop|ertesites|notification|mailer|robot)$/i.test(normalized)) return null;
  return cleaned;
}

function isCourierIdentity(value: string): boolean {
  const normalized = normalizeText(value).trim().toLowerCase();
  return /^(?:gls|dpd|dhl|ups|mpl|foxpost|packeta|express\s*one|magyar posta)(?:\b|\s)/i.test(normalized);
}

function hasTransactionalCorroboration(document: EmailDocumentV1): boolean {
  if (document.signals.orderNumbers.length > 0) return true;
  if (document.signals.trackingNumbers.length > 0) return true;
  if (document.signals.products.length > 0) return true;
  if (document.sections.some((section) => section.type !== 'other')) return true;

  const subject = normalizeText(document.subject ?? '').toLowerCase();
  return /\b(?:rendeles|megrendeles|order|purchase|szamla|invoice|receipt|fizetes|payment|refund|visszaterites|shipment|delivery|csomag|kuldemeny)\b/i.test(subject);
}

function explicitClaims(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const claims: EvidenceClaim<string>[] = [];
  const patterns: Array<{ pattern: RegExp; qualifier: string; confidence: number }> = [
    {
      pattern: /^\s*(?:merchant|seller|store|shop|webshop|elad[oó]|keresked[oő]|[uü]zlet|forgalmaz[oó])\s*[:：-]\s*(.+?)\s*$/gim,
      qualifier: 'explicit_merchant_label',
      confidence: 0.99,
    },
    {
      pattern: /^\s*(?:parcel sender|package sender|felad[oó])\s*[:：-]\s*(.+?)\s*$/gim,
      qualifier: 'explicit_sender_label',
      confidence: 0.96,
    },
  ];

  for (const { pattern, qualifier, confidence } of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = cleanMerchant(match[1] ?? '');
      if (!value) continue;
      claims.push({
        field: 'merchant',
        value,
        confidence: source === 'subject' ? Math.min(0.99, confidence - 0.01) : confidence,
        source,
        extractorId: 'universal-merchant',
        extractorVersion: UNIVERSAL_MERCHANT_EXTRACTOR_VERSION,
        qualifiers: [qualifier],
      });
    }
  }
  return claims;
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const claim of claims) {
    const key = normalizeText(claim.value).trim().toLowerCase();
    const current = best.get(key);
    if (!current || claim.confidence > current.confidence) best.set(key, claim);
  }
  return [...best.values()];
}

export const universalMerchantExtractor: EvidenceExtractor = {
  id: 'universal-merchant',
  version: UNIVERSAL_MERCHANT_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims: EvidenceClaim<string>[] = [
      ...explicitClaims(document.subject ?? '', 'subject'),
      ...explicitClaims(document.text, 'body'),
    ];

    const displayName = cleanMerchant(document.sender.primaryName ?? '');
    if (displayName && !isCourierIdentity(displayName)) {
      const transactional = hasTransactionalCorroboration(document);
      claims.push({
        field: 'merchant',
        value: displayName,
        confidence: transactional ? 0.86 : 0.68,
        source: 'sender',
        extractorId: 'universal-merchant',
        extractorVersion: UNIVERSAL_MERCHANT_EXTRACTOR_VERSION,
        qualifiers: [transactional ? 'sender_transactional_identity' : 'sender_display_name_fallback'],
      });
    }

    return dedupe(claims);
  },
};
