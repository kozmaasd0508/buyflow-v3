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

export function auditStructuredMarkup(html: string): StructuredMarkupAudit {
  const jsonLdTypes = new Set<string>();
  const microdataTypes = new Set<string>();
  let jsonLdBlocks = 0;
  let jsonLdParseErrors = 0;

  const scriptRegex = /<script\b[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    jsonLdBlocks += 1;
    const raw = decodeBasicHtmlEntities((match[1] ?? '').trim())
      .replace(/^<!--\s*/, '')
      .replace(/\s*-->$/, '')
      .trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdTypes(parsed, jsonLdTypes, new Set<object>());
    } catch {
      jsonLdParseErrors += 1;
    }
  }

  const itemTypeRegex = /\bitemtype\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi;
  for (const match of html.matchAll(itemTypeRegex)) {
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
