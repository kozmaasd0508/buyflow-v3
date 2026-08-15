import type { NormalizedEmail } from '../email/types.js';
import { auditStructuredMarkup } from '../email/structured-markup.js';
import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';

export interface CommerceEmailFilterDecision {
  relevant: boolean;
  reasons: string[];
  commerceMarkupTypes: string[];
}

const COMMERCE_KEYWORDS = [
  'order',
  'rendelés',
  'rendeles',
  'csomag',
  'shipment',
  'shipped',
  'delivery',
  'delivered',
  'tracking',
  'nyomkövet',
  'nyomkovet',
  'invoice',
  'számla',
  'szamla',
  'receipt',
  'nyugta',
  'refund',
  'visszatér',
  'visszater',
  'return',
  'visszaküld',
  'visszakuld',
  'payment',
  'fizetés',
  'fizetes',
  'subscription',
  'előfizetés',
  'elofizetes',
];

function senderDomains(email: NormalizedEmail): string[] {
  return email.from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@'));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

function isExpressOneDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return normalized === 'expressone.hu' || normalized.endsWith('.expressone.hu');
}

/**
 * Express One also sends confirmations for courier pickup orders made by a sender
 * in its WEBCAS portal. Those are logistics-service bookings, not consumer
 * purchases or inbound parcel lifecycle events and must stay out of BuyFlow.
 */
export function isExpressOneOutboundPickupNoise(email: NormalizedEmail): boolean {
  if (!senderDomains(email).some(isExpressOneDomain)) return false;

  const text = normalizeText(`${email.subject ?? ''}\n${email.snippet ?? ''}\n${email.bodyHtml ?? ''}`);
  const hasPickupTerm = /\barufelvetel[a-z]*/i.test(text);
  if (!hasPickupTerm) return false;

  const hasWebcasPickupUrl = /\brequest_curier\b/i.test(text)
    || /webcas\.expressone\.hu\/request_curier/i.test(text);
  const hasOperationalPickupEvidence = [
    /\brogzitett arufelvetel[a-z]*/i,
    /\barufelvetel[a-z]* statusza/i,
    /\bmegrendelt arufelveteli/i,
    /\barufelvetel[a-z]* lemondas[a-z]*/i,
    /\bmegbizast a futar elfogadta/i,
    /\barufelvetel[a-z]* dija/i,
  ].some((pattern) => pattern.test(text));

  return hasWebcasPickupUrl || hasOperationalPickupEvidence;
}

function searchableText(email: NormalizedEmail): string {
  const attachmentNames = email.attachments.map((attachment) => attachment.filename).join(' ');
  return `${email.subject ?? ''} ${email.snippet ?? ''} ${attachmentNames}`.toLowerCase();
}

export function filterCommerceEmail(email: NormalizedEmail): CommerceEmailFilterDecision {
  if (isExpressOneOutboundPickupNoise(email)) {
    return {
      relevant: false,
      reasons: ['excluded_expressone_outbound_pickup_service'],
      commerceMarkupTypes: [],
    };
  }

  const reasons: string[] = [];
  const folders = new Set(email.folders.map((folder) => folder.toUpperCase()));

  if (folders.has('CATEGORY_PURCHASES')) {
    reasons.push('gmail_category_purchases');
  }

  const markup = email.bodyHtml
    ? auditStructuredMarkup(email.bodyHtml)
    : {
        commerceTypes: [] as string[],
      };

  if (markup.commerceTypes.length > 0) {
    reasons.push('structured_commerce_markup');
  }

  if (senderDomains(email).some((domain) => isCarrierSenderDomain(domain))) {
    reasons.push('known_carrier_sender');
  }

  const haystack = searchableText(email);
  if (COMMERCE_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    reasons.push('commerce_keyword');
  }

  return {
    relevant: reasons.length > 0,
    reasons: [...new Set(reasons)],
    commerceMarkupTypes: markup.commerceTypes,
  };
}
