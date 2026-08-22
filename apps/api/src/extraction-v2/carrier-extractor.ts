import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';
import { currentMessageLines } from './event-type-extractor.js';

export const UNIVERSAL_CARRIER_EXTRACTOR_VERSION = 'universal-carrier-v1';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCarrier(value: string): string | null {
  const cleaned = value.replace(/[|;,]+$/, '').trim();
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (!/[\p{L}]/u.test(cleaned)) return null;
  return cleaned;
}

function explicitClaims(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const claims: EvidenceClaim<string>[] = [];
  const lines = source === 'subject' ? [text] : currentMessageLines(text);
  const pattern = /^\s*(?:carrier|courier|delivery\s+service|shipping\s+carrier|fut[aá]r|fut[aá]rszolg[aá]lat|k[eé]zbes[ií]t[oő])\s*[:：-]\s*(.+?)\s*$/i;
  for (const line of lines) {
    const match = line.match(pattern);
    const value = cleanCarrier(match?.[1] ?? '');
    if (!value) continue;
    claims.push({
      field: 'carrier',
      value,
      confidence: source === 'subject' ? 0.985 : 0.99,
      source,
      extractorId: 'universal-carrier',
      extractorVersion: UNIVERSAL_CARRIER_EXTRACTOR_VERSION,
      qualifiers: ['explicit_carrier_label'],
    });
  }
  return claims;
}

function carrierAppearsInCurrentMessage(carrier: string, text: string): boolean {
  const normalizedText = normalizeText(currentMessageLines(text).join('\n')).toLowerCase();
  const normalizedCarrier = normalizeText(carrier).toLowerCase();
  if (!normalizedCarrier) return false;

  const aliases: Record<string, RegExp> = {
    'express one': /\bexpress\s*one\b/i,
    gls: /\bgls\b/i,
    dpd: /\bdpd\b/i,
    foxpost: /\bfoxpost\b/i,
    packeta: /\bpacketa\b/i,
    dhl: /\bdhl\b/i,
    ups: /\bups\b/i,
    mpl: /\b(?:mpl|magyar posta)\b/i,
  };
  const alias = aliases[normalizedCarrier];
  return alias ? alias.test(normalizedText) : normalizedText.includes(normalizedCarrier);
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const claim of claims) {
    const key = normalizeText(claim.value).toLowerCase();
    const current = best.get(key);
    if (!current || claim.confidence > current.confidence) best.set(key, claim);
  }
  return [...best.values()];
}

export const universalCarrierExtractor: EvidenceExtractor = {
  id: 'universal-carrier',
  version: UNIVERSAL_CARRIER_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims: EvidenceClaim<string>[] = [
      ...explicitClaims(document.subject ?? '', 'subject'),
      ...explicitClaims(document.text, 'body'),
    ];

    for (const candidate of document.signals.couriers) {
      const value = cleanCarrier(candidate);
      if (!value || !carrierAppearsInCurrentMessage(value, document.text)) continue;
      claims.push({
        field: 'carrier',
        value,
        confidence: 0.90,
        // This signal is derived from the current body. Keeping it at body
        // precedence prevents a weak document candidate from silently
        // outranking an explicit carrier label.
        source: 'body',
        extractorId: 'universal-carrier',
        extractorVersion: UNIVERSAL_CARRIER_EXTRACTOR_VERSION,
        qualifiers: ['document_active_carrier_signal'],
      });
    }

    return dedupe(claims);
  },
};
