import type { EmailDocumentV1 } from '../ingestion/email-document.js';

export type RegioTechnicalEvidenceKind = 'platform' | 'event' | 'order_number';

export interface RegioTechnicalEvidenceV1 {
  kind: RegioTechnicalEvidenceKind;
  rawValue: string;
  normalizedValue: string;
  namespace?: string;
  source: 'merchant_semantic';
  sourcePath: string;
  extractorId: 'regio-siteengine-evidence-v1';
  extractorVersion: '1.0.0';
  confidence: number;
  qualifiers: string[];
}

export interface RegioTechnicalEvidenceV1Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: RegioTechnicalEvidenceV1[];
}

function normalizeDomain(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function headerText(document: EmailDocumentV1): string {
  return document.headers
    .map((header) => `${header.name.trim().toLowerCase()}:${String(header.value ?? '')}`)
    .join('\n');
}

function hasAuthenticatedRegioSiteEngine(document: EmailDocumentV1): boolean {
  if (normalizeDomain(document.sender.primaryDomain) !== 'regiojatek.hu') return false;
  const headers = headerText(document);
  const dkimPass = /authentication-results:[^\n]*dkim=pass[^\n]*header\.i=@regiojatek\.hu\b/i.test(headers)
    || /arc-authentication-results:[^\n]*dkim=pass[^\n]*header\.i=@regiojatek\.hu\b/i.test(headers);
  const siteEngineBoundary = /content-type:[^\n]*multipart\/alternative[^\n]*boundary=["']?SiteEngine\(c\)GreyMatter-/i.test(headers);
  return dkimPass && siteEngineBoundary;
}

function normalizeOrderNumber(value: string): string | null {
  const normalized = value.toUpperCase().replace(/\s+/g, ' ').trim();
  return /^WS \d{3,10}\/\d{4}$/.test(normalized) ? normalized : null;
}

function explicitOrderNumbers(document: EmailDocumentV1): Set<string> {
  const values = new Set<string>();
  const combined = `${document.subject ?? ''}\n${document.text ?? ''}`;
  for (const pattern of [
    /\b(WS\s+\d{3,10}\/\d{4})\s+számú\s+megrendelés/gi,
    /\bRendelésszám:\s*(WS\s+\d{3,10}\/\d{4})\b/gi,
  ]) {
    for (const match of combined.matchAll(pattern)) {
      const normalized = normalizeOrderNumber(match[1] ?? '');
      if (normalized) values.add(normalized);
    }
  }
  return values;
}

function lifecycleFromCurrentMessage(document: EmailDocumentV1): 'order_created' | 'order_processing' | 'shipment' | null {
  const subject = document.subject ?? '';
  const text = document.text ?? '';

  if (/^WS\s+\d{3,10}\/\d{4}\s+számú\s+megrendelésedet\s+megkaptuk!$/i.test(subject)
    && /visszaigazoljuk[\s\S]{0,220}megrendelésed[\s\S]{0,220}megérkezett[\s\S]{0,100}rögzítettük/i.test(text)) {
    return 'order_created';
  }

  if (/^WS\s+\d{3,10}\/\d{4}\s+számú\s+megrendelés\s+teljesítésének\s+megkezdése$/i.test(subject)
    && /megrendelésed\s+feldolgozását\s+megkezdtük/i.test(text)) {
    return 'order_processing';
  }

  if (/^WS\s+\d{3,10}\/\d{4}\s+számú\s+megrendelésedet\s+átadtuk\s+a\s+szállítónak!$/i.test(subject)
    && /rendelt\s+termékeket\s+átadtuk\s+a\s+futárszolgálatnak\s+kiszállításra/i.test(text)) {
    return 'shipment';
  }

  return null;
}

/**
 * Narrow REGIO/SiteEngine development adapter.
 *
 * The SiteEngine(c)GreyMatter MIME boundary is only a platform fingerprint.
 * Purchase authority additionally requires authenticated REGIO transport,
 * one exact current-message lifecycle template and one unique explicit WS order id.
 * Survey/review mail may contain the same sender, platform and order number, so it
 * intentionally receives no evidence unless a current lifecycle template is proven.
 */
export function collectRegioTechnicalEvidenceV1(document: EmailDocumentV1): RegioTechnicalEvidenceV1Result {
  if (!hasAuthenticatedRegioSiteEngine(document)) {
    return { schemaVersion: 1, mode: 'shadow', productionWrites: 0, aiCalls: 0, evidence: [] };
  }

  const lifecycle = lifecycleFromCurrentMessage(document);
  const orderNumbers = explicitOrderNumbers(document);
  if (!lifecycle || orderNumbers.size !== 1) {
    return { schemaVersion: 1, mode: 'shadow', productionWrites: 0, aiCalls: 0, evidence: [] };
  }

  const orderNumber = [...orderNumbers][0]!;
  const subjectOrder = normalizeOrderNumber(
    document.subject?.match(/^(WS\s+\d{3,10}\/\d{4})\b/i)?.[1] ?? '',
  );
  if (!subjectOrder || subjectOrder !== orderNumber) {
    return { schemaVersion: 1, mode: 'shadow', productionWrites: 0, aiCalls: 0, evidence: [] };
  }

  const evidence: RegioTechnicalEvidenceV1[] = [
    {
      kind: 'platform',
      rawValue: 'SiteEngine(c)GreyMatter',
      normalizedValue: 'SiteEngine(c)GreyMatter',
      source: 'merchant_semantic',
      sourcePath: 'headers.content-type.boundary',
      extractorId: 'regio-siteengine-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: 0.995,
      qualifiers: ['authenticated_regiojatek_transport', 'siteengine_greymatter_boundary'],
    },
    {
      kind: 'order_number',
      rawValue: orderNumber,
      normalizedValue: orderNumber,
      namespace: 'MERCHANT:regiojatek.hu',
      source: 'merchant_semantic',
      sourcePath: 'subject+body.regio.explicit_order_identity',
      extractorId: 'regio-siteengine-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: 0.997,
      qualifiers: ['authenticated_regiojatek_transport', 'explicit_matching_ws_order_identity'],
    },
    {
      kind: 'event',
      rawValue: lifecycle,
      normalizedValue: lifecycle,
      source: 'merchant_semantic',
      sourcePath: 'subject+body.regio.current_lifecycle',
      extractorId: 'regio-siteengine-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: 0.995,
      qualifiers: ['authenticated_regiojatek_transport', 'siteengine_greymatter_boundary', 'explicit_current_message_lifecycle'],
    },
  ];

  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
  };
}
