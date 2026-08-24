import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import {
  collectTechnicalEvidenceV11,
  type TechnicalEvidenceV11,
} from './technical-evidence-v1-1.js';
import type { TechnicalEvidenceKind, TechnicalEvidenceSource } from './technical-evidence-v1.js';

export const TECHNICAL_EVIDENCE_V12_VERSION = '1.2.0' as const;

export interface TechnicalEvidenceV12 extends Omit<TechnicalEvidenceV11, 'extractorVersion'> {
  extractorVersion: '1.0.0' | '1.1.0' | typeof TECHNICAL_EVIDENCE_V12_VERSION;
}

export interface TechnicalEvidenceShadowV12Result {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V12_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: TechnicalEvidenceV12[];
  ranExtractors: Array<{
    id: string;
    version: '1.0.0' | '1.1.0' | typeof TECHNICAL_EVIDENCE_V12_VERSION;
    evidenceCount: number;
  }>;
}

export interface TechnicalEvidenceShadowV12Summary {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V12_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidenceCount: number;
  bySource: Partial<Record<TechnicalEvidenceSource, number>>;
  kindsPresent: TechnicalEvidenceKind[];
  identifierKindsPresent: Array<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>;
  hasStructuredData: boolean;
}

function normalizeIdentifier(value: string): string | undefined {
  const normalized = value.trim().replace(/^#/, '').trim();
  if (normalized.length < 3 || normalized.length > 160) return undefined;
  if (!/[0-9]/.test(normalized)) return undefined;
  if (!/^[A-Z0-9._/#:+-]+$/i.test(normalized)) return undefined;
  return normalized.toUpperCase();
}

function v12Evidence(input: Omit<TechnicalEvidenceV12, 'extractorVersion'>): TechnicalEvidenceV12 {
  return { ...input, extractorVersion: TECHNICAL_EVIDENCE_V12_VERSION };
}

function headerValues(document: EmailDocumentV1, name: string): string[] {
  return document.headers
    .filter((header) => header.name.trim().toLowerCase() === name.toLowerCase())
    .map((header) => String(header.value ?? '').trim())
    .filter(Boolean);
}

/**
 * Small audited platform-family semantics. These are not merchant rules.
 * Each rule requires a stable generator/platform fingerprint and refuses to
 * derive a hard identifier from opaque platform-internal ids.
 */
export function extractPlatformSemanticEvidenceV12(document: EmailDocumentV1): TechnicalEvidenceV12[] {
  const results: TechnicalEvidenceV12[] = [];
  const html = document.html ?? '';
  const text = document.text ?? '';

  // UNAS distinguishes order-confirmation generation from later admin/status
  // mail in X-Mailer. The trailing numeric value is a shop/account id, NOT an
  // order id and is deliberately ignored.
  for (const value of headerValues(document, 'x-mailer')) {
    if (/^Unas\s+MAIL\s+\/shop_order_send\.php(?:\s+\d+)?$/i.test(value)) {
      results.push(v12Evidence({
        kind: 'platform',
        rawValue: value,
        normalizedValue: 'UNAS',
        source: 'header',
        sourcePath: 'header.x-mailer',
        extractorId: 'platform-semantic-evidence-v1.2',
        confidence: 0.995,
        qualifiers: ['unas', 'order_confirmation_generator'],
      }));
      results.push(v12Evidence({
        kind: 'event',
        rawValue: '/shop_order_send.php',
        normalizedValue: 'order_created',
        source: 'header',
        sourcePath: 'header.x-mailer.action',
        extractorId: 'platform-semantic-evidence-v1.2',
        confidence: 0.97,
        qualifiers: ['unas', 'exact_generator_action'],
      }));
    } else if (/^Unas\s+MAIL\b/i.test(value)) {
      results.push(v12Evidence({
        kind: 'platform',
        rawValue: value,
        normalizedValue: 'UNAS',
        source: 'header',
        sourcePath: 'header.x-mailer',
        extractorId: 'platform-semantic-evidence-v1.2',
        confidence: 0.99,
        qualifiers: ['unas'],
      }));
    }
  }

  // WooCommerce order tables expose a stable English `Order #...` field even
  // when the surrounding customer copy is localized. Require multiple
  // WooCommerce DOM primitives before accepting the identifier. This proves
  // order identity but intentionally does NOT prove ORDER_CREATED lifecycle.
  const wooPrice = /woocommerce-Price-amount/i.test(html);
  const wooCurrency = /woocommerce-Price-currencySymbol/i.test(html);
  const wooCommerceStructure = wooPrice && wooCurrency;
  if (wooCommerceStructure) {
    const match = /\bOrder\s*#\s*([A-Z0-9][A-Z0-9._/-]{2,63})\b/i.exec(text);
    const rawValue = match?.[1]?.trim();
    const normalizedValue = rawValue ? normalizeIdentifier(rawValue) : undefined;
    if (rawValue && normalizedValue) {
      results.push(v12Evidence({
        kind: 'order_number',
        rawValue,
        normalizedValue,
        namespace: 'WOOCOMMERCE_ORDER',
        source: 'html_attribute',
        sourcePath: 'html.composite.woocommerce_order_table.order_number',
        extractorId: 'platform-semantic-evidence-v1.2',
        confidence: 0.985,
        qualifiers: ['woocommerce', 'multi_primitive_template_context'],
      }));
    }
  }

  // Shopify transport fingerprints are useful platform provenance but are not
  // enough to infer an order lifecycle state. Require two independent signals.
  const rawHeaderText = document.headers.map((header) => `${header.name}:${String(header.value ?? '')}`).join('\n');
  const shopifySignals = [
    /mailer\.shopify\.com/i.test(rawHeaderText),
    /@shopify\.com\b/i.test(rawHeaderText),
    /feedback-id:[^\n]*shopify/i.test(rawHeaderText),
    /order-list__product-image/i.test(html),
  ].filter(Boolean).length;
  if (shopifySignals >= 2) {
    results.push(v12Evidence({
      kind: 'platform',
      rawValue: 'authenticated Shopify notification fingerprint',
      normalizedValue: 'Shopify',
      source: 'authentication',
      sourcePath: 'headers+html.composite.shopify_notification',
      extractorId: 'platform-semantic-evidence-v1.2',
      confidence: 0.995,
      qualifiers: ['shopify', `independent_signals:${shopifySignals}`],
    }));
  }

  return results;
}

function htmlUrls(html: string): string[] {
  const urls: string[] = [];
  const pattern = /\b(?:href|action)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  for (const match of html.matchAll(pattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').replace(/&amp;/gi, '&').trim();
    if (value) urls.push(value);
  }
  return urls;
}

/**
 * Provider-qualified aliases that would be unsafe globally. For example `ids`
 * becomes tracking only on the official Posta tracking endpoint.
 */
export function extractQualifiedUrlEvidenceV12(document: EmailDocumentV1): TechnicalEvidenceV12[] {
  if (!document.html) return [];
  const results: TechnicalEvidenceV12[] = [];
  let urlIndex = 0;
  for (const rawUrl of htmlUrls(document.html)) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl, 'https://buyflow.invalid/');
    } catch {
      urlIndex += 1;
      continue;
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if ((host === 'posta.hu' || host === 'www.posta.hu') && path.includes('/nyomkovetes/nyitooldal')) {
      const rawValue = parsed.searchParams.get('ids')?.trim() ?? '';
      const normalizedValue = normalizeIdentifier(rawValue);
      if (normalizedValue) {
        results.push(v12Evidence({
          kind: 'tracking_number',
          rawValue,
          normalizedValue,
          namespace: 'MPL',
          source: 'url',
          sourcePath: `html.url[${urlIndex}].posta.hu.nyomkovetes.query.ids`,
          extractorId: 'qualified-url-evidence-v1.2',
          confidence: 0.995,
          qualifiers: ['official_tracking_host', 'provider_qualified_alias'],
        }));
      }
    }
    urlIndex += 1;
  }
  return results;
}

/** Dedicated machine headers whose field name itself unambiguously types data. */
export function extractProviderHeaderEvidenceV12(document: EmailDocumentV1): TechnicalEvidenceV12[] {
  const results: TechnicalEvidenceV12[] = [];
  for (const header of document.headers) {
    const name = header.name.trim().toLowerCase();
    const rawValue = String(header.value ?? '').trim();
    if (!rawValue) continue;

    if (name === 'x-szamlazz-invoice') {
      const normalizedValue = normalizeIdentifier(rawValue);
      if (!normalizedValue) continue;
      results.push(v12Evidence({
        kind: 'invoice_number',
        rawValue,
        normalizedValue,
        namespace: 'SZAMLAZZ_HU',
        source: 'header',
        sourcePath: 'header.x-szamlazz-invoice',
        extractorId: 'provider-header-evidence-v1.2',
        confidence: 0.999,
        qualifiers: ['dedicated_machine_field'],
      }));
      results.push(v12Evidence({
        kind: 'event',
        rawValue: 'X-Szamlazz-Invoice',
        normalizedValue: 'invoice_or_receipt',
        namespace: 'SZAMLAZZ_HU',
        source: 'header',
        sourcePath: 'header.x-szamlazz-invoice.presence',
        extractorId: 'provider-header-evidence-v1.2',
        confidence: 0.995,
        qualifiers: ['dedicated_invoice_header'],
      }));
    }
  }
  return results;
}

function dedupe(rows: TechnicalEvidenceV12[]): TechnicalEvidenceV12[] {
  const seen = new Set<string>();
  const output: TechnicalEvidenceV12[] = [];
  for (const row of rows) {
    const key = [row.kind, row.normalizedValue ?? row.rawValue, row.source, row.sourcePath, row.extractorId].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

export function collectTechnicalEvidenceV12(document: EmailDocumentV1): TechnicalEvidenceShadowV12Result {
  const base = collectTechnicalEvidenceV11(document);
  const platformRows = extractPlatformSemanticEvidenceV12(document);
  const qualifiedUrlRows = extractQualifiedUrlEvidenceV12(document);
  const providerHeaderRows = extractProviderHeaderEvidenceV12(document);
  const evidence = dedupe([...base.evidence, ...platformRows, ...qualifiedUrlRows, ...providerHeaderRows]);

  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V12_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
    ranExtractors: [
      ...base.ranExtractors,
      { id: 'platform-semantic-evidence-v1.2', version: TECHNICAL_EVIDENCE_V12_VERSION, evidenceCount: platformRows.length },
      { id: 'qualified-url-evidence-v1.2', version: TECHNICAL_EVIDENCE_V12_VERSION, evidenceCount: qualifiedUrlRows.length },
      { id: 'provider-header-evidence-v1.2', version: TECHNICAL_EVIDENCE_V12_VERSION, evidenceCount: providerHeaderRows.length },
    ],
  };
}

export function summarizeTechnicalEvidenceV12(result: TechnicalEvidenceShadowV12Result): TechnicalEvidenceShadowV12Summary {
  const bySource: Partial<Record<TechnicalEvidenceSource, number>> = {};
  const kinds = new Set<TechnicalEvidenceKind>();
  const identifierKinds = new Set<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>();
  for (const row of result.evidence) {
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    kinds.add(row.kind);
    if (row.kind === 'order_number' || row.kind === 'tracking_number' || row.kind === 'invoice_number' || row.kind === 'payment_reference') {
      identifierKinds.add(row.kind);
    }
  }
  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V12_VERSION,
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
