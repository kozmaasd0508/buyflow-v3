import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_EVENT_TYPE_EXTRACTOR_VERSION = 'universal-event-type-v3';

export type UniversalCommerceEventType =
  | 'order_created'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'payment_completed'
  | 'refund'
  | 'return'
  | 'cancellation';

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

/**
 * Keeps only the current message portion for lifecycle classification.
 * Quoted/forwarded history can still exist in EmailDocument for field extraction,
 * but it must not create a second lifecycle event for the current email.
 */
export function currentMessageLines(text: string): string[] {
  const result: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const normalized = normalizeText(line);
    if (/^-{2,}\s*(?:original message|forwarded message|tovabbitott uzenet|eredeti uzenet)\s*-{2,}$/i.test(normalized)) break;
    if (/^on .+ wrote:\s*$/i.test(line)) break;
    if (/^.+ irta:\s*$/i.test(normalized) && /\b(?:20\d{2}|@)\b/.test(normalized)) break;
    if (/^>/.test(line)) continue;
    if (line) result.push(line);
  }
  return result;
}

type EventPattern = {
  eventType: UniversalCommerceEventType;
  qualifier: string;
  confidence: number;
  patterns: RegExp[];
};

const EVENT_PATTERNS: EventPattern[] = [
  {
    eventType: 'delivery',
    qualifier: 'explicit_delivery_event',
    confidence: 0.995,
    patterns: [
      /\b(?:csomag(?:od|ja)?|kuldemeny(?:ed|e)?|rendeles(?:ed|e)?|megrendeles(?:ed|e)?)\s+(?:sikeresen\s+)?kezbesitve\b/i,
      /\b(?:sikeresen\s+)?kezbesitett(?:uk|ek|e)\b/i,
      /\b(?:your\s+)?(?:order|parcel|package|shipment)\s+(?:has\s+been\s+)?(?:successfully\s+)?delivered\b/i,
      /\bsuccessfully\s+delivered\b/i,
    ],
  },
  {
    eventType: 'shipment',
    qualifier: 'explicit_shipment_event',
    confidence: 0.99,
    patterns: [
      /\b(?:csomag(?:od|ja)?|kuldemeny(?:ed|e)?|rendeles(?:ed|e)?|megrendeles(?:ed|e)?)\s+(?:feladasra\s+kerult|feladva|uton\s+van)\b/i,
      /\b(?:rendeles(?:ed|e)?|megrendeles(?:ed|e)?|csomag(?:od|ja)?)\w*.*\b(?:atadtuk|atadasra\s+kerult)\b.*\b(?:futar|futarszolgalat)\b/i,
      /\b(?:csomag|kuldemeny)\w*.{0,100}\bkezbesitesre\s+(?:atvette|atvettuk|atadva)\b/i,
      /\b(?:your\s+)?(?:order|parcel|package|shipment)\s+(?:has\s+been\s+)?(?:shipped|dispatched)\b/i,
      /\b(?:handed|passed)\s+(?:over\s+)?to\s+(?:the\s+)?(?:carrier|courier)\b/i,
    ],
  },
  {
    eventType: 'refund',
    qualifier: 'explicit_refund_event',
    confidence: 0.995,
    patterns: [
      /\bvisszaterites\s+(?:megtortent|sikeres|teljesitve|elinditva)\b/i,
      /\b(?:refund|reimbursement)\b(?:(?!\brequest\b)[^.!?\n]){0,96}\b(?:has\s+been\s+|was\s+)?(?:completed|successful|issued|processed)\b/i,
      /\bwe\s+(?:have\s+)?refunded\b/i,
    ],
  },
  {
    eventType: 'payment_completed',
    qualifier: 'explicit_payment_completed_event',
    confidence: 0.99,
    patterns: [
      /\b(?:sikeres\s+(?:bankkartyas\s+)?fizetes|fizetes\s+(?:sikeres|megtortent|teljesitve)|sikeres\s+tranzakcio|befizetes\s+beerkezett)\b/i,
      /\b(?:payment|transaction)\s+(?:completed|successful|received)\b/i,
      /\bsuccessfully\s+paid\b/i,
    ],
  },
  {
    eventType: 'cancellation',
    qualifier: 'explicit_cancellation_event',
    confidence: 0.99,
    patterns: [
      /\b(?:rendeles(?:ed|e)?|megrendeles(?:ed|e)?)\s+(?:torolve|lemondva|torlesre\s+kerult)\b/i,
      /\b(?:order|purchase)\s+(?:has\s+been\s+)?cancelled\b/i,
    ],
  },
  {
    eventType: 'return',
    qualifier: 'explicit_return_event',
    confidence: 0.98,
    patterns: [
      /\b(?:visszakuldes|visszakuldott\s+(?:csomag|termek))\w*\s+(?:beerkezett|atvettuk|elfogadva)\b/i,
      /\b(?:return|returned\s+(?:parcel|package|item))\s+(?:received|accepted)\b/i,
    ],
  },
  {
    eventType: 'invoice_or_receipt',
    qualifier: 'explicit_invoice_event',
    confidence: 0.97,
    patterns: [
      /\b(?:szamla(?:d|ja)?|nyugta(?:d|ja)?)\s+(?:elkeszult|kiallitva|elerheto)\b/i,
      /\b(?:fizetesi\s+bizonylat|payment\s+receipt)\b/i,
      /\b(?:rendeles|megrendeles)\b.{0,64}\bnyugta(?:ja|d)?\b/i,
      /\b(?:invoice|receipt)\s+(?:is\s+)?(?:ready|available|issued|created)\b/i,
      /\b(?:your\s+)?(?:invoice|receipt)\s+for\s+(?:order|purchase)\b/i,
    ],
  },
  {
    eventType: 'order_created',
    qualifier: 'explicit_order_created_event',
    confidence: 0.96,
    patterns: [
      /\b(?:koszonjuk|koszonjuk),?\s+(?:hogy\s+)?(?:rendeltel|leadta\w*\s+a\s+rendeles)\b/i,
      /\b(?:webaruhazunkban|webshopunkban)?\s*.{0,48}\brendelest\s+(?:adott|adtal)\s+le\b/i,
      /\b(?:rendeles(?:ed|e)?|megrendeles(?:ed|e)?)\s+(?:beerkezett|rogzitettuk|fogadtuk|visszaigazolva)\b/i,
      /\b(?:rendeles|megrendeles)\s+visszaigazolas(?:a)?\b/i,
      /\b(?:order|purchase)\s+(?:confirmed|confirmation|received)\b/i,
      /\bwe(?:'ve|\s+have)?\s+received\s+your\s+order\b/i,
    ],
  },
];

function scan(text: string, source: 'subject' | 'body'): EvidenceClaim<string>[] {
  const lines = source === 'subject' ? [text] : currentMessageLines(text);
  const claims: EvidenceClaim<string>[] = [];
  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    for (const item of EVENT_PATTERNS) {
      if (!item.patterns.some((pattern) => pattern.test(line))) continue;
      claims.push({
        field: 'event_type',
        value: item.eventType,
        confidence: source === 'subject' ? Math.min(0.995, item.confidence + 0.003) : item.confidence,
        source,
        extractorId: 'universal-event-type',
        extractorVersion: UNIVERSAL_EVENT_TYPE_EXTRACTOR_VERSION,
        qualifiers: [item.qualifier],
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

export const universalEventTypeExtractor: EvidenceExtractor = {
  id: 'universal-event-type',
  version: UNIVERSAL_EVENT_TYPE_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    return dedupe([
      ...scan(document.subject ?? '', 'subject'),
      ...scan(document.text, 'body'),
    ]);
  },
};
