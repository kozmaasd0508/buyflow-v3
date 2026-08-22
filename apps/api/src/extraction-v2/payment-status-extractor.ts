import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_PAYMENT_STATUS_EXTRACTOR_VERSION = 'universal-payment-status-v1';

type PaymentStatusEvidence = 'paid' | 'cash_on_delivery' | 'failed' | 'refunded';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

const FAILED = /\b(?:sikertelen\s+(?:bankkartyas\s+)?fizetes|fizetes\s+sikertelen|tranzakcio\s+sikertelen|sikertelen\s+tranzakcio|payment\s+(?:failed|unsuccessful|declined)|transaction\s+(?:failed|declined))\b/i;
const REFUNDED = /\b(?:visszaterites\s+(?:megtortent|sikeres|teljesitve)|sikeres\s+visszaterites|refund\s+(?:completed|successful)|payment\s+refunded|refunded)\b/i;
const COD = /(?:fizetesi\s+mod|payment\s+method)\s*[:：-]?\s*(?:utanvet(?:el|tel|es)?|cash\s+on\s+delivery|cod)\b|\b(?:utanvet(?:es)?(?:i)?\s+osszeg|beszedendo\s+osszeg|cash\s+on\s+delivery\s+amount|cod\s+amount)\b/i;
const PAID = /\b(?:sikeres\s+(?:bankkartyas\s+)?fizetes|fizetes\s+sikeres|fizetes\s+megtortent|fizetes\s+teljesitve|kifizetve|sikeres\s+tranzakcio|tranzakcio\s+sikeres|sikeres\s+befizetes|befizetes\s+beerkezett|payment\s+(?:completed|successful|received)|transaction\s+successful|successfully\s+paid|paid\s+successfully)\b/i;

function statusForLine(line: string): { status: PaymentStatusEvidence; qualifier: string; confidence: number } | null {
  const normalized = normalizeText(line);
  if (FAILED.test(normalized)) return { status: 'failed', qualifier: 'explicit_payment_failure', confidence: 0.995 };
  if (REFUNDED.test(normalized)) return { status: 'refunded', qualifier: 'explicit_refund_completion', confidence: 0.995 };
  if (COD.test(normalized)) return { status: 'cash_on_delivery', qualifier: 'explicit_cod_evidence', confidence: 0.99 };
  if (PAID.test(normalized) && !/\b(?:nem|not)\s+(?:volt\s+)?sikeres\b/i.test(normalized)) {
    return { status: 'paid', qualifier: 'explicit_paid_evidence', confidence: 0.99 };
  }
  return null;
}

function scan(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const claims: EvidenceClaim<string>[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const result = statusForLine(rawLine);
    if (!result) continue;
    claims.push({
      field: 'payment_status',
      value: result.status,
      confidence: source === 'subject' ? Math.min(0.995, result.confidence) : result.confidence,
      source,
      extractorId: 'universal-payment-status',
      extractorVersion: UNIVERSAL_PAYMENT_STATUS_EXTRACTOR_VERSION,
      qualifiers: [result.qualifier],
    });
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

export const universalPaymentStatusExtractor: EvidenceExtractor = {
  id: 'universal-payment-status',
  version: UNIVERSAL_PAYMENT_STATUS_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    return dedupe([
      ...scan(document.subject ?? '', 'subject'),
      ...scan(document.text, 'body'),
    ]);
  },
};
