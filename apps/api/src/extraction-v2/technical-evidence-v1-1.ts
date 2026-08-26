import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';
import {
  collectTechnicalEvidenceV1,
  type TechnicalEvidence,
  type TechnicalEvidenceKind,
  type TechnicalEvidenceSource,
} from './technical-evidence-v1.js';

export const TECHNICAL_EVIDENCE_V11_VERSION = '1.1.0' as const;

export interface TechnicalEvidenceV11 extends Omit<TechnicalEvidence, 'extractorVersion'> {
  extractorVersion: '1.0.0' | typeof TECHNICAL_EVIDENCE_V11_VERSION;
}

export interface TechnicalEvidenceShadowV11Result {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V11_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: TechnicalEvidenceV11[];
  ranExtractors: Array<{
    id: string;
    version: '1.0.0' | typeof TECHNICAL_EVIDENCE_V11_VERSION;
    evidenceCount: number;
  }>;
}

export interface TechnicalEvidenceShadowV11Summary {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V11_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidenceCount: number;
  bySource: Partial<Record<TechnicalEvidenceSource, number>>;
  kindsPresent: TechnicalEvidenceKind[];
  identifierKindsPresent: Array<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>;
  hasStructuredData: boolean;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeIdentifier(value: string): string | undefined {
  const normalized = value.trim().replace(/^#/, '').trim();
  if (normalized.length < 3 || normalized.length > 160) return undefined;
  if (!/[0-9]/.test(normalized)) return undefined;
  if (!/^[A-Z0-9._/#:+-]+$/i.test(normalized)) return undefined;
  return normalized.toUpperCase();
}

function v11Evidence(input: Omit<TechnicalEvidenceV11, 'extractorVersion'>): TechnicalEvidenceV11 {
  return {
    ...input,
    extractorVersion: TECHNICAL_EVIDENCE_V11_VERSION,
  };
}

function eventFromCompositeTag(value: string): string | null {
  const token = normalizeToken(value);
  if (['orderconfirm', 'orderconfirmation', 'ordercreated', 'neworder'].includes(token)) return 'order_created';
  if (['ordersent', 'ordershipped', 'orderdispatch', 'orderdispatched', 'shipmentcreated'].includes(token)) return 'shipment';
  if (['orderinvoice', 'orderreceipt', 'invoicecreated'].includes(token)) return 'invoice_or_receipt';
  if (['orderpaid', 'paymentcompleted', 'paymentsuccess'].includes(token)) return 'payment_completed';
  if (['shipmentdelivered', 'orderdelivered'].includes(token)) return 'delivery';
  return null;
}

/**
 * Adds exact composite template/provider tag mappings discovered by the real-mail
 * measurement. The mapping stays provider-independent: only the semantic header
 * name and exact normalized tag vocabulary grant an event claim.
 */
export function extractCompositeHeaderEventEvidenceV11(document: EmailDocumentV1): TechnicalEvidenceV11[] {
  const results: TechnicalEvidenceV11[] = [];
  for (const header of document.headers) {
    const name = header.name.trim();
    const value = String(header.value ?? '').trim();
    if (!name || !value) continue;
    if (!/tag|event|template|category|type/i.test(name)) continue;
    const event = eventFromCompositeTag(value);
    if (!event) continue;
    results.push(v11Evidence({
      kind: 'event',
      rawValue: value,
      normalizedValue: event,
      source: 'header',
      sourcePath: `header.${name.toLowerCase()}`,
      extractorId: 'composite-header-event-v1.1',
      confidence: 0.97,
      qualifiers: ['exact_composite_template_tag'],
    }));
  }
  return results;
}

type LabelledIdentifierPattern = {
  kind: 'order_number' | 'tracking_number' | 'invoice_number';
  qualifier: string;
  pattern: RegExp;
  confidence: number;
};

const LABELLED_IDENTIFIER_PATTERNS: LabelledIdentifierPattern[] = [
  {
    kind: 'tracking_number',
    qualifier: 'shipment_id',
    pattern: /\bshipment\s+(?:id|number|no\.?|nr\.?)[\s:#-]*([A-Z0-9][A-Z0-9._/-]{7,63})\b/gi,
    confidence: 0.995,
  },
  {
    kind: 'tracking_number',
    qualifier: 'air_waybill',
    pattern: /\b(?:following\s+)?air\s+waybill[\s:#-]*([A-Z0-9][A-Z0-9._/-]{7,63})\b/gi,
    confidence: 0.995,
  },
  {
    kind: 'tracking_number',
    qualifier: 'parcel_number',
    pattern: /\bparcel\s+(?:number|no\.?|id)[\s:#-]*([A-Z0-9][A-Z0-9._/-]{7,63})\b/gi,
    confidence: 0.995,
  },
  {
    kind: 'tracking_number',
    qualifier: 'shipment_registered_id',
    pattern: /\bshipment\b.{0,180}\bregistered\b.{0,120}\b(?:following\s+)?id[\s:#-]*([A-Z0-9][A-Z0-9._/-]{7,63})\b/gi,
    confidence: 0.99,
  },
  {
    kind: 'order_number',
    qualifier: 'order_number',
    pattern: /\border\s+(?:number|no\.?|id)[\s:#-]*([A-Z0-9][A-Z0-9._/-]{3,63})\b/gi,
    confidence: 0.99,
  },
  {
    kind: 'invoice_number',
    qualifier: 'invoice_number',
    pattern: /\binvoice\s+(?:number|no\.?|id)[\s:#-]*([A-Z0-9][A-Z0-9._/-]{3,63})\b/gi,
    confidence: 0.99,
  },
];

type LifecyclePattern = {
  event: string;
  qualifier: string;
  pattern: RegExp;
  confidence: number;
};

const ALTERNATE_LIFECYCLE_PATTERNS: LifecyclePattern[] = [
  {
    event: 'delivery',
    qualifier: 'delivered_phrase',
    pattern: /\b(?:shipment|parcel|package|order)\b.{0,220}\bhas\s+been\s+(?:successfully\s+)?delivered\b/i,
    confidence: 0.995,
  },
  {
    event: 'shipment',
    qualifier: 'processing_phrase',
    pattern: /\b(?:begun|began|started)\s+(?:the\s+)?processing\s+of\s+(?:your\s+)?(?:parcel|shipment|package)\b/i,
    confidence: 0.98,
  },
  {
    event: 'shipment',
    qualifier: 'out_for_delivery_phrase',
    pattern: /\b(?:our\s+)?(?:driver|courier)\s+(?:is\s+)?(?:going\s+to|will)\s+deliver\b/i,
    confidence: 0.99,
  },
  {
    event: 'shipment',
    qualifier: 'shipped_phrase',
    pattern: /\b(?:your\s+)?(?:shipment|parcel|package|order)\s+(?:has\s+been\s+)?(?:shipped|dispatched)\b/i,
    confidence: 0.985,
  },
  {
    event: 'invoice_or_receipt',
    qualifier: 'invoice_phrase',
    pattern: /\b(?:invoice|receipt)\s+(?:is\s+)?(?:ready|available|issued|created)\b/i,
    confidence: 0.98,
  },
];

function currentMessageText(document: EmailDocumentV1): string {
  return currentMessageLines(document.text).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extracts strict English machine-like labels and lifecycle statements from the
 * current message only. It intentionally ignores generic bare `id`/`ref` values
 * and quoted/forwarded history. These claims remain shadow-only observations.
 */
export function extractAlternateLanguageEvidenceV11(document: EmailDocumentV1): TechnicalEvidenceV11[] {
  const text = currentMessageText(document);
  if (!text) return [];
  const results: TechnicalEvidenceV11[] = [];

  for (const item of LABELLED_IDENTIFIER_PATTERNS) {
    const matcher = new RegExp(item.pattern.source, item.pattern.flags);
    let matchIndex = 0;
    for (const match of text.matchAll(matcher)) {
      const rawValue = match[1]?.trim();
      if (!rawValue) continue;
      const normalizedValue = normalizeIdentifier(rawValue);
      if (!normalizedValue) continue;
      results.push(v11Evidence({
        kind: item.kind,
        rawValue,
        normalizedValue,
        source: 'alternate_text',
        sourcePath: `body.current_message.${item.qualifier}[${matchIndex}]`,
        extractorId: 'alternate-language-evidence-v1.1',
        confidence: item.confidence,
        qualifiers: ['labelled_english_identifier', item.qualifier],
      }));
      matchIndex += 1;
    }
  }

  for (const item of ALTERNATE_LIFECYCLE_PATTERNS) {
    if (!item.pattern.test(text)) continue;
    results.push(v11Evidence({
      kind: 'event',
      rawValue: item.qualifier,
      normalizedValue: item.event,
      source: 'alternate_text',
      sourcePath: `body.current_message.${item.qualifier}`,
      extractorId: 'alternate-language-evidence-v1.1',
      confidence: item.confidence,
      qualifiers: ['explicit_english_lifecycle', item.qualifier],
    }));
  }

  return results;
}

function dedupeEvidenceV11(rows: TechnicalEvidenceV11[]): TechnicalEvidenceV11[] {
  const seen = new Set<string>();
  const results: TechnicalEvidenceV11[] = [];
  for (const row of rows) {
    const key = [
      row.kind,
      row.normalizedValue ?? row.rawValue,
      row.source,
      row.sourcePath,
      row.extractorId,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(row);
  }
  return results;
}

/**
 * Additive v1.1 collector. It preserves all v1 evidence and adds only the two
 * generic machine-semantic families measured as missing on real Gmail.
 * No DB write, AI call, identity decision or production-parser mutation occurs.
 */
export function collectTechnicalEvidenceV11(document: EmailDocumentV1): TechnicalEvidenceShadowV11Result {
  const base = collectTechnicalEvidenceV1(document);
  const compositeHeaderRows = extractCompositeHeaderEventEvidenceV11(document);
  const alternateRows = extractAlternateLanguageEvidenceV11(document);
  const evidence = dedupeEvidenceV11([
    ...base.evidence,
    ...compositeHeaderRows,
    ...alternateRows,
  ]);

  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V11_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
    ranExtractors: [
      ...base.ranExtractors,
      {
        id: 'composite-header-event-v1.1',
        version: TECHNICAL_EVIDENCE_V11_VERSION,
        evidenceCount: compositeHeaderRows.length,
      },
      {
        id: 'alternate-language-evidence-v1.1',
        version: TECHNICAL_EVIDENCE_V11_VERSION,
        evidenceCount: alternateRows.length,
      },
    ],
  };
}

export function summarizeTechnicalEvidenceV11(result: TechnicalEvidenceShadowV11Result): TechnicalEvidenceShadowV11Summary {
  const bySource: Partial<Record<TechnicalEvidenceSource, number>> = {};
  const kinds = new Set<TechnicalEvidenceKind>();
  const identifierKinds = new Set<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>();

  for (const row of result.evidence) {
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    kinds.add(row.kind);
    if (
      row.kind === 'order_number'
      || row.kind === 'tracking_number'
      || row.kind === 'invoice_number'
      || row.kind === 'payment_reference'
    ) {
      identifierKinds.add(row.kind);
    }
  }

  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V11_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidenceCount: result.evidence.length,
    bySource,
    kindsPresent: [...kinds].sort(),
    identifierKindsPresent: [...identifierKinds].sort(),
    hasStructuredData: (bySource.structured_data ?? 0) > 0,
  };
}
