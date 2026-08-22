import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';
import { currentMessageLines } from './event-type-extractor.js';

export const UNIVERSAL_PAYMENT_STATUS_EXTRACTOR_VERSION = 'universal-payment-status-v4';

type PaymentStatusEvidence = 'paid' | 'cash_on_delivery' | 'failed' | 'refunded';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

const FAILED = /\b(?:sikertelen\s+(?:bankkartyas\s+)?fizetes|fizetes\s+sikertelen|tranzakcio\s+sikertelen|sikertelen\s+tranzakcio|payment\s+(?:failed|unsuccessful|declined)|transaction\s+(?:failed|declined))\b/i;
const REFUNDED = /\b(?:visszaterites\s+(?:megtortent|sikeres|teljesitve|elinditva)|sikeres\s+visszaterites|(?:refund|reimbursement)\s+(?:completed|successful|issued|processed)|(?:refund|reimbursement)\b(?:(?!\brequest\b)[^.!?\n]){0,64}\b(?:has\s+been|was)\s+(?:successfully\s+)?(?:completed|issued|processed)|(?:payment|transaction|charge|amount)\s+(?:has\s+been\s+|was\s+)?refunded|we\s+(?:have\s+)?refunded)\b/i;
const COD_VALUE = /\b(?:utanvet(?:el|tel|es)?|cash\s+on\s+delivery|cod)\b/i;
const COD = /(?:fizetesi\s+mod|payment\s+method)\s*[:：-]?\s*(?:utanvet(?:el|tel|es)?|cash\s+on\s+delivery|cod)\b|\b(?:utanvet(?:es)?(?:i)?\s+osszeg|beszedendo\s+osszeg|cash\s+on\s+delivery\s+amount|cod\s+amount)\b/i;
const PAYMENT_METHOD_LABEL = /^\s*(?:fizetesi\s+mod|payment\s+method)\s*[:：-]?\s*$/i;
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

function claim(input: {
  status: PaymentStatusEvidence;
  confidence: number;
  source: 'subject' | 'body' | 'document_structure';
  qualifier: string;
}): EvidenceClaim<string> {
  return {
    field: 'payment_status',
    value: input.status,
    confidence: input.confidence,
    source: input.source,
    extractorId: 'universal-payment-status',
    extractorVersion: UNIVERSAL_PAYMENT_STATUS_EXTRACTOR_VERSION,
    qualifiers: [input.qualifier],
  };
}

function scan(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const claims: EvidenceClaim<string>[] = [];
  const lines = source === 'body' ? currentMessageLines(text) : [text];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const result = statusForLine(rawLine);
    if (result) {
      claims.push(claim({
        status: result.status,
        confidence: source === 'subject' ? Math.min(0.995, result.confidence) : result.confidence,
        source,
        qualifier: result.qualifier,
      }));
    }

    if (source === 'body' && PAYMENT_METHOD_LABEL.test(normalizeText(rawLine))) {
      const nextLine = lines.slice(index + 1).find((candidate) => Boolean(candidate.trim())) ?? '';
      if (COD_VALUE.test(normalizeText(nextLine))) {
        claims.push(claim({
          status: 'cash_on_delivery',
          confidence: 0.985,
          source: 'body',
          qualifier: 'explicit_cod_evidence',
        }));
      }
    }
  }
  return claims;
}

function dedupe(claims: EvidenceClaim<string>[]): EvidenceClaim<string>[] {
  const best = new Map<string, EvidenceClaim<string>>();
  for (const item of claims) {
    const current = best.get(item.value);
    if (!current || item.confidence > current.confidence) best.set(item.value, item);
  }
  return [...best.values()];
}

export const universalPaymentStatusExtractor: EvidenceExtractor = {
  id: 'universal-payment-status',
  version: UNIVERSAL_PAYMENT_STATUS_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims = [
      ...scan(document.subject ?? '', 'subject'),
      ...scan(document.text, 'body'),
    ];

    for (const method of document.signals.paymentMethods) {
      if (!COD_VALUE.test(normalizeText(method))) continue;
      claims.push(claim({
        status: 'cash_on_delivery',
        confidence: 0.98,
        source: 'document_structure',
        qualifier: 'document_payment_method_cod',
      }));
    }

    return dedupe(claims);
  },
};
