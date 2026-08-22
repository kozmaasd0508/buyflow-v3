import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';
import { currentMessageLines } from './event-type-extractor.js';

export const UNIVERSAL_CARRIER_EXTRACTOR_VERSION = 'universal-carrier-v3';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CARRIER_ALIASES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Express One', pattern: /\bexpress\s*one\b/i },
  { name: 'GLS', pattern: /\bgls\b/i },
  { name: 'DPD', pattern: /\bdpd\b/i },
  { name: 'Foxpost', pattern: /\bfoxpost\b/i },
  { name: 'Packeta', pattern: /\bpacketa\b/i },
  { name: 'DHL', pattern: /\bdhl\b/i },
  { name: 'UPS', pattern: /\bups\b/i },
  { name: 'MPL', pattern: /\b(?:mpl|magyar posta)\b/i },
];

function canonicalCarrierFromText(value: string): string | null {
  const normalized = normalizeText(value);
  const match = CARRIER_ALIASES.find((candidate) => candidate.pattern.test(normalized));
  return match?.name ?? null;
}

function cleanCarrier(value: string): string | null {
  const canonical = canonicalCarrierFromText(value);
  if (canonical) return canonical;
  const cleaned = value.replace(/[|;,]+$/, '').trim();
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (!/[\p{L}]/u.test(cleaned)) return null;
  return cleaned;
}

function claim(input: {
  value: string;
  confidence: number;
  source: 'subject' | 'body' | 'document_structure';
  qualifier: string;
}): EvidenceClaim<string> {
  return {
    field: 'carrier',
    value: input.value,
    confidence: input.confidence,
    source: input.source,
    extractorId: 'universal-carrier',
    extractorVersion: UNIVERSAL_CARRIER_EXTRACTOR_VERSION,
    qualifiers: [input.qualifier],
  };
}

function explicitClaims(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const claims: EvidenceClaim<string>[] = [];
  const lines = source === 'subject' ? [text] : currentMessageLines(text);
  const pattern = /^\s*(?:carrier|courier|delivery\s+service|shipping\s+carrier|shipping\s+method|delivery\s+method|fut[aá]r|fut[aá]rszolg[aá]lat|k[eé]zbes[ií]t[oő]|sz[aá]ll[ií]t[aá]si\s+m[oó]d|sz[aá]ll[ií]t[aá]s\s+m[oó]dja)\s*[:：-]\s*(.+?)\s*$/i;
  for (const line of lines) {
    const match = line.match(pattern);
    const value = cleanCarrier(match?.[1] ?? '');
    if (!value) continue;
    claims.push(claim({
      value,
      confidence: source === 'subject' ? 0.985 : 0.99,
      source,
      qualifier: 'explicit_carrier_label',
    }));
  }
  return claims;
}

function aliasFor(carrier: string): RegExp | null {
  const canonical = canonicalCarrierFromText(carrier);
  return canonical ? CARRIER_ALIASES.find((candidate) => candidate.name === canonical)?.pattern ?? null : null;
}

const TRANSPORT_CONTEXT = /\b(?:tracking|track|shipment|shipping|delivery|parcel|package|carrier|courier|futar|futarszolgalat|csomag|kuldemeny|kezbesites|kezbesitve|szallitas|szallitmany|nyomkovetes)\b/i;

function carrierAppearsInTransportContext(carrier: string, text: string): boolean {
  const alias = aliasFor(carrier);
  if (!alias) return false;
  const lines = currentMessageLines(text).map((line) => normalizeText(line).toLowerCase());

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!alias.test(line)) continue;
    const window = [lines[index - 1] ?? '', line, lines[index + 1] ?? ''].join(' ');
    if (TRANSPORT_CONTEXT.test(window)) return true;
  }
  return false;
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const item of claims) {
    const key = normalizeText(item.value).toLowerCase();
    const current = best.get(key);
    if (!current || item.confidence > current.confidence) best.set(key, item);
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

    for (const method of document.signals.shippingMethods) {
      const value = canonicalCarrierFromText(method);
      if (!value) continue;
      claims.push(claim({
        value,
        confidence: 0.98,
        source: 'document_structure',
        qualifier: 'document_shipping_method_carrier',
      }));
    }

    for (const candidate of document.signals.couriers) {
      const value = cleanCarrier(candidate);
      if (!value || !carrierAppearsInTransportContext(value, document.text)) continue;
      claims.push(claim({
        value,
        confidence: 0.90,
        source: 'body',
        qualifier: 'document_active_carrier_signal',
      }));
    }

    return dedupe(claims);
  },
};
