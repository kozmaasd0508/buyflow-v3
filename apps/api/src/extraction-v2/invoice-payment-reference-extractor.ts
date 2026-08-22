import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_INVOICE_PAYMENT_REFERENCE_VERSION = 'universal-invoice-payment-reference-v1';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function normalizeIdentifier(value: string): string | null {
  const cleaned = value.trim().replace(/^#+/, '').replace(/[.,;:)]+$/, '');
  if (cleaned.length < 4 || cleaned.length > 64 || !/\d/.test(cleaned)) return null;
  if (!/^[A-Z0-9][A-Z0-9._:/-]*$/i.test(cleaned)) return null;
  return cleaned;
}

function collect(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const normalized = normalizeText(text);
  const claims: EvidenceClaim<string>[] = [];
  const patterns: Array<{
    field: 'invoice_number' | 'payment_reference';
    pattern: RegExp;
    qualifier: string;
    confidence: number;
  }> = [
    {
      field: 'invoice_number',
      pattern: /\b(?:szamlaszam|szamla\s+szama|szamlaazonosito|bizonylatszam|invoice(?:\s+(?:number|no\.?|id))?|receipt(?:\s+(?:number|no\.?|id))?)\s*[:#-]?\s*#?([A-Z0-9][A-Z0-9._:/-]{3,63})\b/gi,
      qualifier: 'explicit_invoice_label',
      confidence: 0.99,
    },
    {
      field: 'invoice_number',
      pattern: /\b(?:szamla|invoice)\s+#?([A-Z0-9][A-Z0-9._:/-]{3,63})\b/gi,
      qualifier: 'contextual_invoice_identifier',
      confidence: 0.94,
    },
    {
      field: 'payment_reference',
      pattern: /\b(?:tranzakcio(?:\s+(?:azonosito|id|referencia))?|transaction(?:\s+(?:id|reference|no\.?))?|payment(?:\s+(?:id|reference|reference\s+number))|fizetesi\s+(?:azonosito|referencia))\s*[:#-]?\s*#?([A-Z0-9][A-Z0-9._:/-]{3,63})\b/gi,
      qualifier: 'explicit_payment_reference_label',
      confidence: 0.99,
    },
  ];

  for (const item of patterns) {
    item.pattern.lastIndex = 0;
    for (const match of normalized.matchAll(item.pattern)) {
      const value = normalizeIdentifier(match[1] ?? '');
      if (!value) continue;
      claims.push({
        field: item.field,
        value,
        confidence: source === 'subject' ? Math.min(0.99, item.confidence - 0.01) : item.confidence,
        source,
        extractorId: 'universal-invoice-payment-reference',
        extractorVersion: UNIVERSAL_INVOICE_PAYMENT_REFERENCE_VERSION,
        qualifiers: [item.qualifier],
      });
    }
  }

  return claims;
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const claim of claims) {
    const key = `${claim.field}:${claim.value.toUpperCase()}`;
    const current = best.get(key);
    if (!current || claim.confidence > current.confidence) best.set(key, claim);
  }
  return [...best.values()];
}

export const universalInvoicePaymentReferenceExtractor: EvidenceExtractor = {
  id: 'universal-invoice-payment-reference',
  version: UNIVERSAL_INVOICE_PAYMENT_REFERENCE_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    return dedupe([
      ...collect(document.subject ?? '', 'subject'),
      ...collect(document.text, 'body'),
    ]);
  },
};
