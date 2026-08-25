import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_MERCHANT_EXTRACTOR_VERSION = 'universal-merchant-v3';

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

const GENERIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
]);

function compactIdentity(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function domainSupportsIdentity(displayName: string, domain: string | null): boolean {
  if (!domain) return false;
  const normalizedDomain = domain.trim().toLowerCase();
  if (GENERIC_MAIL_DOMAINS.has(normalizedDomain)) return false;

  const display = compactIdentity(displayName);
  const labels = normalizedDomain
    .split('.')
    .map((part) => part.replace(/[^a-z0-9-]/g, ''))
    .filter((part) => part.length >= 4)
    .filter((part) => !/^(?:mail|email|smtp|notify|notification|news|mg|www|cloud|online)$/.test(part));

  return labels.some((label) => display.includes(label.replace(/-/g, '')));
}

function hasCommercialIdentityToken(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return /\b(?:kft|zrt|nyrt|bt|ltd|limited|inc|corp|corporation|company|gmbh|srl|shop|store|webshop|market|premium|services|service|billing|payments|orders|official)\b/i.test(normalized);
}

function hasPersonalBylineConnector(value: string): boolean {
  const normalized = normalizeText(value).trim().toLowerCase();
  return normalized.split(/\s+/).length >= 3 && /\b(?:a|az|from|at)\b/i.test(normalized);
}

function looksLikePersonalName(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((word) => /^[\p{Lu}][\p{L}'’-]+$/u.test(word));
}

function senderIdentityCanResolveMerchant(document: EmailDocumentV1, displayName: string): boolean {
  if (!hasTransactionalCorroboration(document)) return false;
  if (isCourierIdentity(displayName)) return false;
  if (hasPersonalBylineConnector(displayName)) return false;

  const domainSupported = domainSupportsIdentity(displayName, document.sender.primaryDomain);
  if (looksLikePersonalName(displayName) && !domainSupported) return false;

  return hasCommercialIdentityToken(displayName)
    || domainSupported
    || displayName.trim().split(/\s+/).length === 1;
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
      const resolvable = senderIdentityCanResolveMerchant(document, displayName);
      claims.push({
        field: 'merchant',
        value: displayName,
        confidence: resolvable ? 0.86 : 0.68,
        source: 'sender',
        extractorId: 'universal-merchant',
        extractorVersion: UNIVERSAL_MERCHANT_EXTRACTOR_VERSION,
        qualifiers: [resolvable ? 'sender_commercial_identity' : 'sender_display_name_fallback'],
      });
    }

    return dedupe(claims);
  },
};
