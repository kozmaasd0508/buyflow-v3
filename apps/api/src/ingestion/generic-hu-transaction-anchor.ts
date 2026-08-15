import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { isCarrierSenderDomain } from '../email/sender-role.js';
import {
  isPublicMailboxSenderDomain,
  isSharedPlatformSenderDomain,
} from './generic-order-confirmation-adapter.js';

const PARSER_VERSION = 'generic-hu-transaction-anchor-v1';

export interface GenericHuTransactionAnchorParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
  shipmentPhase?: 'shipped';
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function compactParty(value: string): string {
  const legal = new Set(['kft', 'zrt', 'nyrt', 'bt', 'rt', 'gmbh', 'ltd', 'llc', 'inc', 'ag']);
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !legal.has(token))
    .join('');
}

function domainBrandTokens(domain: string): string[] {
  const generic = new Set(['www', 'mail', 'email', 'service', 'shop', 'store', 'notify', 'notice', 'com', 'hu', 'net', 'org', 'eu', 'co']);
  return normalizeDomain(domain)
    .split('.')
    .map((token) => compactParty(token))
    .filter((token) => token.length >= 4 && !generic.has(token));
}

function merchantMatchesSenderDomain(merchant: string, domain: string): boolean {
  const label = compactParty(merchant);
  if (label.length < 4) return false;
  return domainBrandTokens(domain).some((token) => label === token || token.includes(label));
}

function merchantSenderDomain(domains: string[]): string | null {
  const candidates = domains
    .map(normalizeDomain)
    .filter((domain) =>
      domain &&
      !isCarrierSenderDomain(domain) &&
      !isPublicMailboxSenderDomain(domain) &&
      !isSharedPlatformSenderDomain(domain),
    );
  return candidates.length === 1 ? candidates[0]! : null;
}

function baseExtraction(input: {
  eventType: EmailExtraction['event_type'];
  merchant: string;
  orderNumber: string;
  confidence: number;
}): EmailExtraction {
  return {
    event_type: input.eventType,
    merchant: input.merchant,
    merchant_legal_name: null,
    order_number: input.orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: input.confidence,
  };
}

export function parseGenericHuTransactionAnchor(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): GenericHuTransactionAnchorParseResult | null {
  const domain = merchantSenderDomain(input.senderDomains);
  if (!domain) return null;

  const subject = normalizeText(input.subject ?? '');

  const dispatch = subject.match(/^(.{2,80}?)\s*:\s*#\s*([A-Z0-9][A-Z0-9._/-]{5,39})\s+rendeles\s+elkuldve\.?$/i);
  if (dispatch?.[1] && dispatch[2]) {
    const merchant = dispatch[1].trim();
    const orderNumber = dispatch[2].trim();
    if (!merchantMatchesSenderDomain(merchant, domain)) return null;
    return {
      extraction: baseExtraction({
        eventType: 'shipment',
        merchant,
        orderNumber,
        confidence: 0.92,
      }),
      parserVersion: PARSER_VERSION,
      shipmentPhase: 'shipped',
      reasons: [
        'merchant_owned_sender_domain',
        'merchant_label_matches_sender_domain',
        'explicit_hungarian_order_dispatched_subject',
        'explicit_order_identity',
        'lifecycle_only_never_purchase_creation',
      ],
    };
  }

  const invoice = subject.match(/^szamla\s+(.{2,80}?)\s+\(([A-Z0-9][A-Z0-9._/-]{5,39})\)\s+szamu\s+webrendeleshez\.?$/i);
  if (invoice?.[1] && invoice[2]) {
    const merchant = invoice[1].trim();
    const orderNumber = invoice[2].trim();
    if (!merchantMatchesSenderDomain(merchant, domain)) return null;
    return {
      extraction: baseExtraction({
        eventType: 'invoice_or_receipt',
        merchant,
        orderNumber,
        confidence: 0.9,
      }),
      parserVersion: PARSER_VERSION,
      reasons: [
        'merchant_owned_sender_domain',
        'merchant_label_matches_sender_domain',
        'explicit_hungarian_weborder_invoice_subject',
        'explicit_order_identity',
        'invoice_anchor_never_purchase_creation',
      ],
    };
  }

  return null;
}
