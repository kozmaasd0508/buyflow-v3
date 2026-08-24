import type { EmailDocumentV1 } from '../ingestion/email-document.js';

export type ShopifyTechnicalEvidenceKind =
  | 'platform'
  | 'event'
  | 'order_number'
  | 'tracking_number';

export interface ShopifyTechnicalEvidenceV1 {
  kind: ShopifyTechnicalEvidenceKind;
  rawValue: string;
  normalizedValue: string;
  namespace?: string;
  source: 'shopify_semantic';
  sourcePath: string;
  extractorId: 'shopify-semantic-evidence-v1';
  extractorVersion: '1.0.0';
  confidence: number;
  qualifiers: string[];
}

export interface ShopifyTechnicalEvidenceV1Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: ShopifyTechnicalEvidenceV1[];
}

function normalizeCopy(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

function normalizeDomain(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function headerText(document: EmailDocumentV1): string {
  return document.headers
    .map((header) => `${header.name.trim().toLowerCase()}:${String(header.value ?? '')}`)
    .join('\n');
}

/**
 * Native Shopify transport is deliberately stronger than a Shopify asset or
 * CSS class. We require the Shopify mail relay plus a second independent
 * Shopify-authentication/message signal.
 */
function hasAuthenticatedNativeShopifyTransport(document: EmailDocumentV1): boolean {
  const headers = headerText(document);
  const relay = /received:[^\n]*\bmailer\.shopify\.com\b/i.test(headers);
  const corroborators = [
    /(?:dkim-signature|authentication-results|arc-authentication-results):[^\n]*(?:d=|header\.i=@)(?:t\.)?shopifyemail\.com\b/i.test(headers),
    /return-path:[^\n]*@mailer\.t\.shopifyemail\.com\b/i.test(headers),
    /message-id:[^\n]*@shopify\.com\b/i.test(headers),
    /feedback-id:[^\n]*\bshopify\b/i.test(headers),
    /dmarc=pass[^\n]*header\.from=(?:t\.)?shopifyemail\.com\b/i.test(headers),
  ].filter(Boolean).length;
  return relay && corroborators >= 1;
}

/** Standard transactional Shopify notification DOM, not merely any Shopify asset. */
function hasStandardShopifyOrderTemplate(document: EmailDocumentV1): boolean {
  const html = document.html ?? '';
  const productPrimitive = /order-list__product-image/i.test(html);
  const corroborator = /cdn\.shopify\.com/i.test(html)
    || /order-list__product-description-cell/i.test(html)
    || /customer-info__/i.test(html);
  return productPrimitive && corroborator;
}

function extractOrderNumber(document: EmailDocumentV1): string | null {
  const currentMessage = `${document.subject ?? ''}\n${document.text ?? ''}`;
  const patterns = [
    /\bRendel[eé]s\s*[:(]?\s*#\s*([A-Z0-9][A-Z0-9._/-]{2,39})\b/i,
    /\bOrder\s*(?:number|no\.?)?\s*[:(#]?\s*#?\s*([A-Z0-9][A-Z0-9._/-]{2,39})\b/i,
  ];
  for (const pattern of patterns) {
    const value = currentMessage.match(pattern)?.[1]?.trim();
    if (value && /\d/.test(value)) return value.toUpperCase();
  }
  return null;
}

function storefrontDomain(document: EmailDocumentV1): string | null {
  const primary = normalizeDomain(document.sender.primaryDomain);
  const infrastructure = /(?:^|\.)(?:shopifyemail\.com|shopify\.com|sendgrid\.net|sendgrid\.info|amazonses\.com)$/i;
  if (primary && !infrastructure.test(primary)) return primary;

  const html = document.html ?? '';
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  for (const match of html.matchAll(hrefPattern)) {
    const raw = (match[1] ?? match[2] ?? '').replace(/&amp;/gi, '&').trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    try {
      const host = normalizeDomain(new URL(raw).hostname);
      if (!host || infrastructure.test(host) || /(?:^|\.)cdn\.shopify\.com$/i.test(host)) continue;
      return host;
    } catch {
      // Ignore malformed links; TechnicalEvidence must degrade safely.
    }
  }
  return null;
}

function lifecycleFromCurrentMessage(document: EmailDocumentV1): 'order_created' | 'shipment' | 'delivery' | null {
  const subject = normalizeCopy(document.subject ?? '');
  const text = normalizeCopy(document.text ?? '');

  if (/\brendeles\b.{0,48}\bvisszaigazol/.test(subject)
    || /\border\b.{0,48}\b(?:confirmation|confirmed)\b/.test(subject)) {
    return 'order_created';
  }

  if (/\buton van a kuldemeny\b/.test(subject)
    || /\b(?:shipment|order)\b.{0,48}\bon the way\b/.test(subject)
    || /\bshipping confirmation\b/.test(subject)) {
    return 'shipment';
  }

  if (/\bkuldemeny kezbesitve\b/.test(subject)
    || /\b(?:shipment|order)\b.{0,48}\bdelivered\b/.test(subject)
    || /^delivered\b/.test(subject)) {
    return 'delivery';
  }

  // Body-only lifecycle evidence is accepted only for an explicit current
  // statement. Future/conditional phrases are never promoted.
  if (/\b(?:shipment has been delivered|your order has been delivered)\b/.test(text)) return 'delivery';
  return null;
}

function explicitTrackingNumber(document: EmailDocumentV1): string | null {
  const text = document.text ?? '';
  const patterns = [
    /\bfuvarlev[eé]lsz[aá]m\s*:\s*([A-Z0-9][A-Z0-9-]{7,39})\b/i,
    /\btracking\s*(?:number|no\.?)\s*:\s*([A-Z0-9][A-Z0-9-]{7,39})\b/i,
    /\bnyomk[oö]vet[eé]si\s*sz[aá]m\s*:\s*([A-Z0-9][A-Z0-9-]{7,39})\b/i,
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.trim();
    if (value && /\d/.test(value)) return value.toUpperCase();
  }
  return null;
}

/**
 * Provider-family shadow evidence for native Shopify transactional mail.
 *
 * Authority requires all three independent layers:
 * 1) authenticated native Shopify transport;
 * 2) standard transactional order-template DOM;
 * 3) explicit current-message order identity.
 *
 * Shopify assets alone, Shopify account/security mail, or merchant custom mail
 * sent outside Shopify transport do not receive lifecycle authority.
 */
export function collectShopifyTechnicalEvidenceV1(document: EmailDocumentV1): ShopifyTechnicalEvidenceV1Result {
  if (!hasAuthenticatedNativeShopifyTransport(document) || !hasStandardShopifyOrderTemplate(document)) {
    return { schemaVersion: 1, mode: 'shadow', productionWrites: 0, aiCalls: 0, evidence: [] };
  }

  const orderNumber = extractOrderNumber(document);
  if (!orderNumber) {
    return { schemaVersion: 1, mode: 'shadow', productionWrites: 0, aiCalls: 0, evidence: [] };
  }

  const shopDomain = storefrontDomain(document);
  const lifecycle = lifecycleFromCurrentMessage(document);
  const evidence: ShopifyTechnicalEvidenceV1[] = [
    {
      kind: 'platform',
      rawValue: 'native Shopify transactional notification',
      normalizedValue: 'Shopify',
      source: 'shopify_semantic',
      sourcePath: 'headers+html.shopify.native_transactional',
      extractorId: 'shopify-semantic-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: 0.998,
      qualifiers: ['authenticated_shopify_transport', 'standard_shopify_order_template'],
    },
    {
      kind: 'order_number',
      rawValue: orderNumber,
      normalizedValue: orderNumber,
      ...(shopDomain ? { namespace: `MERCHANT:${shopDomain}` } : {}),
      source: 'shopify_semantic',
      sourcePath: 'current_message.order_label',
      extractorId: 'shopify-semantic-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: shopDomain ? 0.995 : 0.97,
      qualifiers: [
        'authenticated_shopify_transport',
        'explicit_current_message_order_label',
        ...(shopDomain ? ['merchant_storefront_scope'] : ['merchant_scope_required_before_hard_merge']),
      ],
    },
  ];

  if (lifecycle) {
    evidence.push({
      kind: 'event',
      rawValue: lifecycle,
      normalizedValue: lifecycle,
      source: 'shopify_semantic',
      sourcePath: 'subject+body.shopify.current_lifecycle',
      extractorId: 'shopify-semantic-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: lifecycle === 'order_created' ? 0.995 : 0.985,
      qualifiers: [
        'authenticated_shopify_transport',
        'standard_shopify_order_template',
        'explicit_current_message_lifecycle',
        ...(lifecycle === 'order_created' ? ['two_independent_merchants_reviewed'] : ['single_independent_lifecycle_family_reviewed']),
      ],
    });
  }

  if (lifecycle === 'shipment' || lifecycle === 'delivery') {
    const tracking = explicitTrackingNumber(document);
    if (tracking) {
      evidence.push({
        kind: 'tracking_number',
        rawValue: tracking,
        normalizedValue: tracking,
        source: 'shopify_semantic',
        sourcePath: 'body.shopify.explicit_tracking_label',
        extractorId: 'shopify-semantic-evidence-v1',
        extractorVersion: '1.0.0',
        confidence: 0.97,
        qualifiers: [
          'explicit_tracking_label',
          'authenticated_shopify_transport',
          'carrier_namespace_required_before_hard_merge',
        ],
      });
    }
  }

  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
  };
}
