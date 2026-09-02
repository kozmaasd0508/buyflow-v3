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
const MAX_AUDIT_NODES = 10_000;
const MAX_AUDIT_DEPTH = 32;

function normalizeType(value: unknown): string[] {
  if (typeof value === 'string') {
    const last = value.split(/[\/#]/).filter(Boolean).pop() ?? value;
    return last ? [last] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => normalizeType(item));
  return [];
}

function collectJsonLdTypes(value: unknown, output: Set<string>) {
  if (!value || typeof value !== 'object') return;
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_AUDIT_NODES) {
    const current = stack.pop();
    if (!current || current.depth > MAX_AUDIT_DEPTH) continue;
    const node = current.value;
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    visited += 1;

    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        stack.push({ value: node[index], depth: current.depth + 1 });
      }
      continue;
    }

    const record = node as Record<string, unknown>;
    for (const type of normalizeType(record['@type'])) output.add(type);
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') {
        stack.push({ value: nested, depth: current.depth + 1 });
      }
    }
  }
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&#([0-9]{1,7});?/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
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
 * Microdata itemtype records are schema hints only, never field-level evidence.
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
        payload: { itemType: part, fieldEvidence: false },
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
      collectJsonLdTypes(parsed, jsonLdTypes);
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
