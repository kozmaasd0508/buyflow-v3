import type { EmailStructuredDataRecord } from './document-v1.js';

export interface StructuredMarkupAudit {
  hasJsonLd: boolean;
  jsonLdBlocks: number;
  jsonLdParseErrors: number;
  jsonLdTypes: string[];
  hasMicrodata: boolean;
  microdataTypes: string[];
  hasSchemaOrgReference: boolean;
  commerceTypes: string[];
}

const COMMERCE_TYPES = new Set([
  'Order',
  'ParcelDelivery',
  'Invoice',
  'Product',
  'Offer',
  'OrderAction',
  'TrackAction',
  'DeliveryEvent',
  'ReceiveAction',
  'ReturnAction',
  'CancelAction',
]);

const JSON_LD_SCRIPT_REGEX = /<script\b[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi;
const ITEM_TYPE_REGEX = /\bitemtype\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi;

function normalizeType(value: unknown): string[] {
  if (typeof value === 'string') {
    const last = value.split(/[\/#]/).filter(Boolean).pop() ?? value;
    return last ? [last] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => normalizeType(item));
  return [];
}

function collectJsonLdTypes(value: unknown, output: Set<string>, seen: Set<object>) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdTypes(item, output, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const type of normalizeType(record['@type'])) output.add(type);
  for (const nested of Object.values(record)) collectJsonLdTypes(nested, output, seen);
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanedJsonLdSource(raw: string): string {
  return decodeBasicHtmlEntities(raw.trim())
    .replace(/^<!--\s*/, '')
    .replace(/\s*-->$/, '')
    .trim();
}

function topLevelJsonLdNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [value];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record['@graph'])) return record['@graph'];
  return [value];
}

/**
 * Extracts bounded, parseable structured-data records before any AI stage.
 * Malformed/oversized JSON-LD is ignored here and remains visible through
 * auditStructuredMarkup() counters. Raw HTML is never copied into the record.
 */
export function extractStructuredDataRecords(
  html: string,
  options: { maxRecords?: number; maxJsonLdBlockBytes?: number } = {},
): EmailStructuredDataRecord[] {
  const maxRecords = Math.min(Math.max(options.maxRecords ?? 32, 1), 128);
  const maxJsonLdBlockBytes = Math.min(
    Math.max(options.maxJsonLdBlockBytes ?? 128 * 1024, 1024),
    1024 * 1024,
  );
  const records: EmailStructuredDataRecord[] = [];

  for (const match of html.matchAll(JSON_LD_SCRIPT_REGEX)) {
    if (records.length >= maxRecords) break;
    const raw = cleanedJsonLdSource(match[1] ?? '');
    if (!raw || Buffer.byteLength(raw, 'utf8') > maxJsonLdBlockBytes) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      for (const node of topLevelJsonLdNodes(parsed)) {
        if (records.length >= maxRecords) break;
        const schemaType = node && typeof node === 'object'
          ? (normalizeType((node as Record<string, unknown>)['@type'])[0] ?? null)
          : null;
        records.push({
          kind: 'json_ld',
          schemaType,
          payload: node,
          source: 'body_html',
        });
      }
    } catch {
      // Audit path reports malformed JSON-LD; extraction remains fail-closed.
    }
  }

  const seenMicrodata = new Set<string>();
  for (const match of html.matchAll(ITEM_TYPE_REGEX)) {
    if (records.length >= maxRecords) break;
    const value = (match[1] ?? match[2] ?? '').trim();
    if (!/schema\.org/i.test(value)) continue;
    for (const part of value.split(/\s+/)) {
      if (records.length >= maxRecords) break;
      if (!/schema\.org/i.test(part)) continue;
      const schemaType = normalizeType(part)[0];
      if (!schemaType) continue;
      const key = `${schemaType}:${part}`;
      if (seenMicrodata.has(key)) continue;
      seenMicrodata.add(key);
      records.push({
        kind: 'microdata',
        schemaType,
        payload: { itemType: part },
        source: 'body_html',
      });
    }
  }

  return records;
}

export function auditStructuredMarkup(html: string): StructuredMarkupAudit {
  const jsonLdTypes = new Set<string>();
  const microdataTypes = new Set<string>();
  let jsonLdBlocks = 0;
  let jsonLdParseErrors = 0;

  for (const match of html.matchAll(JSON_LD_SCRIPT_REGEX)) {
    jsonLdBlocks += 1;
    const raw = cleanedJsonLdSource(match[1] ?? '');
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdTypes(parsed, jsonLdTypes, new Set<object>());
    } catch {
      jsonLdParseErrors += 1;
    }
  }

  for (const match of html.matchAll(ITEM_TYPE_REGEX)) {
    const value = (match[1] ?? match[2] ?? '').trim();
    if (!/schema\.org/i.test(value)) continue;
    for (const part of value.split(/\s+/)) {
      if (!/schema\.org/i.test(part)) continue;
      for (const type of normalizeType(part)) microdataTypes.add(type);
    }
  }

  const allTypes = new Set([...jsonLdTypes, ...microdataTypes]);
  const commerceTypes = [...allTypes].filter((type) => COMMERCE_TYPES.has(type)).sort();

  return {
    hasJsonLd: jsonLdBlocks > 0,
    jsonLdBlocks,
    jsonLdParseErrors,
    jsonLdTypes: [...jsonLdTypes].sort(),
    hasMicrodata: microdataTypes.size > 0,
    microdataTypes: [...microdataTypes].sort(),
    hasSchemaOrgReference: /https?:\/\/schema\.org\//i.test(html),
    commerceTypes,
  };
}
