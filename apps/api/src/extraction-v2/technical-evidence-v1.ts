import type { EmailDocumentV1 } from '../ingestion/email-document.js';

export type TechnicalEvidenceSource =
  | 'header'
  | 'authentication'
  | 'structured_data'
  | 'html_title'
  | 'html_attribute'
  | 'alternate_text'
  | 'url';

export type TechnicalEvidenceKind =
  | 'platform'
  | 'event'
  | 'merchant'
  | 'order_number'
  | 'tracking_number'
  | 'invoice_number'
  | 'payment_reference'
  | 'amount'
  | 'currency'
  | 'carrier'
  | 'payment_method'
  | 'product'
  | 'date'
  | 'raw_signal';

export interface TechnicalEvidence {
  kind: TechnicalEvidenceKind;
  rawValue: string;
  normalizedValue?: string;
  namespace?: string;
  source: TechnicalEvidenceSource;
  sourcePath: string;
  extractorId: string;
  extractorVersion: '1.0.0';
  confidence: number;
  qualifiers?: string[];
}

export interface TechnicalEvidenceExtractorRun {
  id: 'header-evidence-v1' | 'url-evidence-v1' | 'html-semantic-evidence-v1' | 'structured-data-evidence-v1';
  version: '1.0.0';
  evidenceCount: number;
}

export interface TechnicalEvidenceShadowV1Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: TechnicalEvidence[];
  ranExtractors: TechnicalEvidenceExtractorRun[];
}

export interface TechnicalEvidenceShadowV1Summary {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidenceCount: number;
  bySource: Partial<Record<TechnicalEvidenceSource, number>>;
  kindsPresent: TechnicalEvidenceKind[];
  identifierKindsPresent: Array<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>;
  hasStructuredData: boolean;
}

const EXTRACTOR_VERSION = '1.0.0' as const;
const IDENTIFIER_KINDS = new Set<TechnicalEvidenceKind>([
  'order_number',
  'tracking_number',
  'invoice_number',
  'payment_reference',
]);

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

function stripTags(value: string): string {
  return decodeBasicHtmlEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedIdentifier(value: string): string | undefined {
  const normalized = decodeBasicHtmlEntities(value).trim().replace(/^#/, '').trim();
  if (normalized.length < 2 || normalized.length > 160) return undefined;
  return normalized.toUpperCase();
}

function normalizedToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function looksLikeIdentifier(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 3
    && normalized.length <= 160
    && /[0-9]/.test(normalized)
    && /^[A-Z0-9._/#:+-]+$/i.test(normalized);
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function evidence(input: Omit<TechnicalEvidence, 'extractorVersion' | 'confidence'> & { confidence: number }): TechnicalEvidence {
  return {
    ...input,
    extractorVersion: EXTRACTOR_VERSION,
    confidence: clampConfidence(input.confidence),
  };
}

function eventFromToken(value: string): string | null {
  const token = normalizedToken(value);
  if (['orderconfirm', 'orderconfirmation', 'ordercreated', 'neworder', 'rendelesvisszaigazolas'].includes(token)) {
    return 'order_created';
  }
  if (['shipment', 'shipmentcreated', 'shippingconfirmation', 'shipped', 'dispatch', 'dispatched'].includes(token)) {
    return 'shipment';
  }
  if (['delivery', 'delivered', 'outfordelivery'].includes(token)) {
    return 'delivery';
  }
  if (['invoice', 'receipt', 'invoicecreated'].includes(token)) {
    return 'invoice_or_receipt';
  }
  if (['paymentcompleted', 'paymentsuccess', 'paid'].includes(token)) {
    return 'payment_completed';
  }
  if (['refund', 'refunded'].includes(token)) return 'refund';
  if (['return', 'returned'].includes(token)) return 'return';
  if (['cancel', 'cancelled', 'canceled', 'cancellation'].includes(token)) return 'cancellation';
  return null;
}

function eventFromTitle(value: string): string | null {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\b(order|rendeles|megrendeles)\b.{0,24}\b(confirm|confirmation|visszaigazolas)\b/.test(normalized)) return 'order_created';
  if (/\b(shipping|shipment|dispatch|feladas|szallitas)\b.{0,24}\b(confirm|confirmation|visszaigazolas|shipped|feladva)\b/.test(normalized)) return 'shipment';
  if (/\b(out for delivery|kezbesites|delivery|delivered)\b/.test(normalized)) return 'delivery';
  if (/\b(invoice|szamla|receipt|nyugta)\b/.test(normalized)) return 'invoice_or_receipt';
  return null;
}

function semanticKindFromName(name: string): TechnicalEvidenceKind | null {
  const token = normalizedToken(name.replace(/^x[-_]?/i, ''));
  if (['order', 'orderid', 'ordernumber', 'orderno', 'rendeles', 'rendelesid', 'rendelesszam', 'megrendelesszam'].includes(token)) {
    return 'order_number';
  }
  if (['tracking', 'trackingid', 'trackingnumber', 'trackingnr', 'parcel', 'parcelid', 'parcelnumber', 'parcelno', 'shipmentid', 'consignment', 'consignmentnumber'].includes(token)) {
    return 'tracking_number';
  }
  if (['invoice', 'invoiceid', 'invoicenumber', 'invoiceno', 'szamla', 'szamlaszam'].includes(token)) {
    return 'invoice_number';
  }
  if (['paymentreference', 'paymentref', 'transactionid', 'transactionreference', 'paymentid'].includes(token)) {
    return 'payment_reference';
  }
  return null;
}

export function extractHeaderTechnicalEvidenceV1(document: EmailDocumentV1): TechnicalEvidence[] {
  const results: TechnicalEvidence[] = [];
  const authenticationHeaders = new Set([
    'authentication-results',
    'dkim-signature',
    'received-spf',
    'arc-authentication-results',
    'return-path',
  ]);

  for (const header of document.headers) {
    const name = header.name.trim();
    const value = String(header.value ?? '').trim();
    if (!name || !value) continue;
    const lowerName = name.toLowerCase();
    const sourcePath = `header.${lowerName}`;

    if (authenticationHeaders.has(lowerName)) {
      results.push(evidence({
        kind: 'raw_signal',
        rawValue: value,
        source: 'authentication',
        sourcePath,
        extractorId: 'header-evidence-v1',
        confidence: 0.99,
        qualifiers: [lowerName],
      }));
      continue;
    }

    const semanticKind = semanticKindFromName(name);
    if (semanticKind && looksLikeIdentifier(value)) {
      const normalized = normalizedIdentifier(value);
      results.push(evidence({
        kind: semanticKind,
        rawValue: value,
        ...(normalized ? { normalizedValue: normalized } : {}),
        source: 'header',
        sourcePath,
        extractorId: 'header-evidence-v1',
        confidence: 0.97,
        qualifiers: ['semantic_header_name'],
      }));
    }

    if (/^(x-)?mailer$/i.test(name) || /platform|provider|generator/i.test(name)) {
      results.push(evidence({
        kind: 'platform',
        rawValue: value,
        normalizedValue: value.trim(),
        source: 'header',
        sourcePath,
        extractorId: 'header-evidence-v1',
        confidence: 0.9,
        qualifiers: ['platform_header'],
      }));
    }

    if (/tag|event|template|category|type/i.test(name)) {
      const event = eventFromToken(value);
      if (event) {
        results.push(evidence({
          kind: 'event',
          rawValue: value,
          normalizedValue: event,
          source: 'header',
          sourcePath,
          extractorId: 'header-evidence-v1',
          confidence: 0.94,
          qualifiers: ['semantic_header_event'],
        }));
      }
    }
  }
  return results;
}

interface HtmlAttributeMatch {
  name: string;
  value: string;
  index: number;
}

function htmlAttributes(html: string): HtmlAttributeMatch[] {
  const results: HtmlAttributeMatch[] = [];
  const pattern = /\b([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of html.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    results.push({
      name,
      value: decodeBasicHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ''),
      index: match.index ?? 0,
    });
  }
  return results;
}

const URL_ORDER_PARAMS = new Set(['order', 'orderid', 'ordernumber', 'orderno', 'rendelesid', 'rendelesszam']);
const URL_TRACKING_PARAMS = new Set(['tracking', 'trackingid', 'trackingnumber', 'trackingnr', 'parcel', 'parcelid', 'parcelnumber', 'parcelno', 'shipmentid', 'consignment', 'consignmentnumber']);
const URL_INVOICE_PARAMS = new Set(['invoice', 'invoiceid', 'invoicenumber', 'invoiceno']);
const URL_PAYMENT_PARAMS = new Set(['paymentreference', 'paymentref', 'paymentid', 'transactionid', 'transactionreference']);

function kindForUrlParam(name: string): TechnicalEvidenceKind | null {
  const token = normalizedToken(name);
  if (URL_ORDER_PARAMS.has(token)) return 'order_number';
  if (URL_TRACKING_PARAMS.has(token)) return 'tracking_number';
  if (URL_INVOICE_PARAMS.has(token)) return 'invoice_number';
  if (URL_PAYMENT_PARAMS.has(token)) return 'payment_reference';
  return null;
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathMarkerKind(value: string): TechnicalEvidenceKind | null {
  const token = normalizedToken(value);
  if (['order', 'orders'].includes(token)) return 'order_number';
  if (['track', 'tracking', 'parcel', 'shipment', 'shipments', 'consignment'].includes(token)) return 'tracking_number';
  if (['invoice', 'invoices'].includes(token)) return 'invoice_number';
  return null;
}

export function extractUrlTechnicalEvidenceV1(document: EmailDocumentV1): TechnicalEvidence[] {
  if (!document.html) return [];
  const results: TechnicalEvidence[] = [];
  const attributes = htmlAttributes(document.html)
    .filter((attribute) => ['href', 'action'].includes(attribute.name.toLowerCase()));

  for (let urlIndex = 0; urlIndex < attributes.length; urlIndex += 1) {
    const attribute = attributes[urlIndex];
    if (!attribute?.value) continue;
    const rawUrl = attribute.value.trim();
    if (!rawUrl || /^javascript:/i.test(rawUrl) || /^mailto:/i.test(rawUrl)) continue;

    let parsed: URL;
    try {
      parsed = new URL(rawUrl, 'https://buyflow.invalid/');
    } catch {
      continue;
    }
    const prefix = `html.${attribute.name.toLowerCase()}[${urlIndex}]`;

    for (const [paramName, paramValue] of parsed.searchParams.entries()) {
      const kind = kindForUrlParam(paramName);
      const value = paramValue.trim();
      if (!kind || !looksLikeIdentifier(value)) continue;
      const normalized = normalizedIdentifier(value);
      results.push(evidence({
        kind,
        rawValue: value,
        ...(normalized ? { normalizedValue: normalized } : {}),
        source: 'url',
        sourcePath: `${prefix}.query.${paramName}`,
        extractorId: 'url-evidence-v1',
        confidence: 0.99,
        qualifiers: ['semantic_query_parameter', `host:${parsed.hostname.toLowerCase()}`],
      }));
    }

    const segments = parsed.pathname.split('/').filter(Boolean).map(safeDecodeUriComponent);
    for (let index = 0; index < segments.length - 1; index += 1) {
      const kind = pathMarkerKind(segments[index] ?? '');
      const value = (segments[index + 1] ?? '').trim();
      if (!kind || !looksLikeIdentifier(value)) continue;
      const normalized = normalizedIdentifier(value);
      results.push(evidence({
        kind,
        rawValue: value,
        ...(normalized ? { normalizedValue: normalized } : {}),
        source: 'url',
        sourcePath: `${prefix}.path[${index + 1}]`,
        extractorId: 'url-evidence-v1',
        confidence: 0.97,
        qualifiers: ['semantic_path_segment', `host:${parsed.hostname.toLowerCase()}`],
      }));
    }
  }
  return results;
}

const PLATFORM_TOKENS: Array<[RegExp, string]> = [
  [/\bwoocommerce\b/i, 'WooCommerce'],
  [/\bshopify\b/i, 'Shopify'],
  [/\bshoprenter\b/i, 'Shoprenter'],
  [/\bunas\b/i, 'UNAS'],
];

function carrierFromText(value: string): string | null {
  const normalized = value.trim();
  const carriers: Array<[RegExp, string]> = [
    [/^GLS$/i, 'GLS'],
    [/^DPD$/i, 'DPD'],
    [/^Express\s*One$/i, 'Express One'],
    [/^Foxpost$/i, 'Foxpost'],
    [/^MPL$/i, 'MPL'],
    [/^Packeta$/i, 'Packeta'],
    [/^DHL$/i, 'DHL'],
    [/^UPS$/i, 'UPS'],
  ];
  return carriers.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export function extractHtmlSemanticTechnicalEvidenceV1(document: EmailDocumentV1): TechnicalEvidence[] {
  if (!document.html) return [];
  const html = document.html;
  const results: TechnicalEvidence[] = [];
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
  if (title) {
    const event = eventFromTitle(title);
    if (event) {
      results.push(evidence({
        kind: 'event',
        rawValue: title,
        normalizedValue: event,
        source: 'html_title',
        sourcePath: 'html.title',
        extractorId: 'html-semantic-evidence-v1',
        confidence: 0.88,
        qualifiers: ['document_title'],
      }));
    }
  }

  const attributes = htmlAttributes(html);
  for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
    const attribute = attributes[attributeIndex];
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim();
    if (!value) continue;
    const sourcePath = `html.attribute[${attributeIndex}].${name}`;

    if (name === 'class' || name === 'id') {
      for (const [pattern, platform] of PLATFORM_TOKENS) {
        if (!pattern.test(value)) continue;
        results.push(evidence({
          kind: 'platform',
          rawValue: value,
          normalizedValue: platform,
          source: 'html_attribute',
          sourcePath,
          extractorId: 'html-semantic-evidence-v1',
          confidence: 0.95,
          qualifiers: [name, 'platform_fingerprint'],
        }));
      }
    }

    if (name.startsWith('data-') || name === 'itemprop') {
      const semanticKind = semanticKindFromName(name.replace(/^data-/, ''));
      if (semanticKind && looksLikeIdentifier(value)) {
        const normalized = normalizedIdentifier(value);
        results.push(evidence({
          kind: semanticKind,
          rawValue: value,
          ...(normalized ? { normalizedValue: normalized } : {}),
          source: 'html_attribute',
          sourcePath,
          extractorId: 'html-semantic-evidence-v1',
          confidence: 0.98,
          qualifiers: ['semantic_attribute_name'],
        }));
      }
    }

    if (name === 'alt' || name === 'title' || name === 'aria-label') {
      const carrier = carrierFromText(value);
      if (carrier) {
        results.push(evidence({
          kind: 'carrier',
          rawValue: value,
          normalizedValue: carrier,
          source: 'alternate_text',
          sourcePath,
          extractorId: 'html-semantic-evidence-v1',
          confidence: 0.9,
          qualifiers: ['alternate_text'],
        }));
      }
    }
  }
  return results;
}

function jsonPrimitive(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function jsonTypeName(value: string): string {
  return value.split(/[\/#]/).filter(Boolean).pop() ?? value;
}

function eventFromJsonLdType(value: string): string | null {
  switch (jsonTypeName(value)) {
    case 'Order':
    case 'OrderAction':
      return 'order_created';
    case 'ParcelDelivery':
    case 'TrackAction':
      return 'shipment';
    case 'DeliveryEvent':
    case 'ReceiveAction':
      return 'delivery';
    case 'Invoice':
      return 'invoice_or_receipt';
    case 'ReturnAction':
      return 'return';
    case 'CancelAction':
      return 'cancellation';
    default:
      return null;
  }
}

function kindFromJsonPath(path: string, key: string): TechnicalEvidenceKind | null {
  const keyToken = normalizedToken(key);
  const pathToken = normalizedToken(path);
  if (['ordernumber', 'orderid'].includes(keyToken)) return 'order_number';
  if (['trackingnumber', 'trackingid', 'trackingcode'].includes(keyToken)) return 'tracking_number';
  if (['invoicenumber', 'invoiceid'].includes(keyToken)) return 'invoice_number';
  if (['paymentreference', 'paymentref', 'transactionid'].includes(keyToken)) return 'payment_reference';
  if (['pricecurrency', 'currency'].includes(keyToken)) return 'currency';
  if (['paymentmethod'].includes(keyToken)) return 'payment_method';
  if (['totalprice', 'ordertotal', 'price'].includes(keyToken)) return 'amount';
  if (['carrier', 'deliverymethod', 'shippingmethod'].includes(keyToken)) return 'carrier';
  if (['orderdate', 'datecreated', 'deliverydate', 'dateissued'].includes(keyToken)) return 'date';
  if (keyToken === 'name' && /(seller|merchant|vendor)/.test(pathToken)) return 'merchant';
  if (keyToken === 'name' && /(product|itemoffered|ordereditem)/.test(pathToken)) return 'product';
  return null;
}

function structuredConfidence(kind: TechnicalEvidenceKind): number {
  if (IDENTIFIER_KINDS.has(kind)) return 0.995;
  if (kind === 'event' || kind === 'merchant' || kind === 'carrier') return 0.98;
  return 0.97;
}

function walkJsonLd(value: unknown, path: string, output: TechnicalEvidence[], seen: Set<object>): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJsonLd(item, `${path}[${index}]`, output, seen));
    return;
  }

  const record = value as Record<string, unknown>;
  const rawType = record['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  for (let index = 0; index < types.length; index += 1) {
    const typeValue = jsonPrimitive(types[index]);
    if (!typeValue) continue;
    const event = eventFromJsonLdType(typeValue);
    if (event) {
      output.push(evidence({
        kind: 'event',
        rawValue: typeValue,
        normalizedValue: event,
        source: 'structured_data',
        sourcePath: `${path}.@type${types.length > 1 ? `[${index}]` : ''}`,
        extractorId: 'structured-data-evidence-v1',
        confidence: 0.99,
        qualifiers: ['schema_org_type'],
      }));
    }
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === '@type') continue;
    const childPath = `${path}.${key}`;
    const primitive = jsonPrimitive(child);
    const kind = kindFromJsonPath(path, key);
    if (primitive && kind) {
      const normalized = IDENTIFIER_KINDS.has(kind)
        ? normalizedIdentifier(primitive)
        : primitive.trim();
      output.push(evidence({
        kind,
        rawValue: primitive,
        ...(normalized ? { normalizedValue: normalized } : {}),
        source: 'structured_data',
        sourcePath: childPath,
        extractorId: 'structured-data-evidence-v1',
        confidence: structuredConfidence(kind),
        qualifiers: ['json_ld'],
      }));
    }
    walkJsonLd(child, childPath, output, seen);
  }
}

export function extractStructuredDataTechnicalEvidenceV1(document: EmailDocumentV1): TechnicalEvidence[] {
  if (!document.html) return [];
  const results: TechnicalEvidence[] = [];
  const scriptPattern = /<script\b[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let blockIndex = 0;
  for (const match of document.html.matchAll(scriptPattern)) {
    const raw = decodeBasicHtmlEntities((match[1] ?? '').trim())
      .replace(/^<!--\s*/, '')
      .replace(/\s*-->$/, '')
      .trim();
    if (!raw) {
      blockIndex += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      walkJsonLd(parsed, `jsonld[${blockIndex}]`, results, new Set<object>());
    } catch {
      // Parse failure is intentionally non-fatal and produces no claim. The
      // existing structured-markup audit remains the place to count malformed blocks.
    }
    blockIndex += 1;
  }
  return results;
}

function dedupeEvidence(rows: TechnicalEvidence[]): TechnicalEvidence[] {
  const seen = new Set<string>();
  const results: TechnicalEvidence[] = [];
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
 * Pure TechnicalEvidence v1 shadow collector.
 *
 * This intentionally does NOT feed Extraction Engine v2 or Purchase Identity
 * Graph v2 yet. It is a separate observational lane so the frozen v2 extraction
 * candidate and existing production parser behavior cannot drift while we measure
 * whether deeper technical evidence improves recall and provenance.
 *
 * Raw evidence may contain message-derived identifiers or header values. Callers
 * must not persist or log the raw bundle; use summarizeTechnicalEvidenceV1() for
 * privacy-reduced diagnostics.
 */
export function collectTechnicalEvidenceV1(document: EmailDocumentV1): TechnicalEvidenceShadowV1Result {
  const headerRows = extractHeaderTechnicalEvidenceV1(document);
  const urlRows = extractUrlTechnicalEvidenceV1(document);
  const htmlRows = extractHtmlSemanticTechnicalEvidenceV1(document);
  const structuredRows = extractStructuredDataTechnicalEvidenceV1(document);
  const evidenceRows = dedupeEvidence([
    ...headerRows,
    ...urlRows,
    ...htmlRows,
    ...structuredRows,
  ]);

  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: evidenceRows,
    ranExtractors: [
      { id: 'header-evidence-v1', version: EXTRACTOR_VERSION, evidenceCount: headerRows.length },
      { id: 'url-evidence-v1', version: EXTRACTOR_VERSION, evidenceCount: urlRows.length },
      { id: 'html-semantic-evidence-v1', version: EXTRACTOR_VERSION, evidenceCount: htmlRows.length },
      { id: 'structured-data-evidence-v1', version: EXTRACTOR_VERSION, evidenceCount: structuredRows.length },
    ],
  };
}

export function summarizeTechnicalEvidenceV1(result: TechnicalEvidenceShadowV1Result): TechnicalEvidenceShadowV1Summary {
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
