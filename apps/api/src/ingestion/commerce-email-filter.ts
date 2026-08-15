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

const TRANSACTIONAL_ANCHOR_PATTERNS = [
  /\b(?:order\s*(?:number|no\.?|id)|rendeles(?:szam|\s+szama|\s+azonosito)|megrendeles(?:szam|\s+szama|\s+azonosito)|bestellnummer)\s*[:#-]?\s*#?[a-z0-9][a-z0-9._/-]{3,39}\b/i,
  /\b(?:tracking(?:\s*(?:number|no\.?|id))?|nyomkovetesi\s*(?:szam|azonosito)|csomag(?:szam|azonosito))\s*[:#-]?\s*[a-z0-9][a-z0-9-]{7,31}\b/i,
  /\b(?:invoice(?:\s*(?:number|no\.?|id))?|szamla(?:szam|\s+szama|\s+azonosito))\s*[:#-]?\s*[a-z0-9][a-z0-9._/-]{3,39}\b/i,
  /\b(?:thank(?:s| you)? for your order|order confirmation|your order (?:is )?confirmed|we (?:have )?received your order|we've received your order)\b/i,
  /\b(?:rendeles visszaigazolas|megrendeles visszaigazolas|koszonjuk (?:a |az )?(?:rendelesed|megrendelesed|rendeleset|megrendeleset)|rendeles(?:ed|e)? (?:sikeresen )?(?:rogzitettuk|beerk(?:ezett|ezett)|megerositve|visszaigazolva))\b/i,
];

const REPURCHASE_MARKETING_PATTERNS = [
  /\blegutobbi vasarlasod\b/i,
  /\bpont egy honapja vasaroltal\b/i,
  /\bkorabbi vasarlasod\b/i,
  /\ba kosarad tartalma ez volt\b/i,
  /\bujra kosarba\b/i,
  /\breload_order_link\b/i,
  /\bvasarolj ujra\b/i,
  /\bbuy again\b/i,
  /\breorder now\b/i,
];

const PROMOTIONAL_CAMPAIGN_PATTERNS = [
  /\buj kollekcio\b/i,
  /\bshop the drop\b/i,
  /\bshop now\b/i,
  /\bexkluziv ajanlat/i,
  /\bexclusive offer/i,
  /\bajandek kupon/i,
  /\bkuponkod/i,
  /\bkuponnal kedveskedunk/i,
  /\bnyeremeny/i,
  /\bjatek(?:unk|ban|kal)?\b/i,
  /\bakcio(?:s|k)?\b/i,
  /\bkedvezmeny(?:ek|ekkel|es)?\b/i,
  /\blimited time\b/i,
  /\bnew collection\b/i,
  /\bfedezd fel\b/i,
  /\bvarunk(?: az| a)?\b/i,
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

function plainishEmailText(email: NormalizedEmail): string {
  const body = (email.bodyHtml ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
  return normalizeText(`${email.subject ?? ''}\n${email.snippet ?? ''}\n${body}`)
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * Marketing messages can mention old purchases, carts, product prices or even a
 * future "package" and therefore look commerce-like. Exclude them only when we
 * have strong promotional/repurchase evidence and no transactional identity or
 * explicit order-confirmation anchor. Gmail Promotions is intentionally NOT a
 * gate because real receipts may be miscategorized by Gmail.
 */
export function isPromotionalCommerceNoise(email: NormalizedEmail): boolean {
  const text = plainishEmailText(email);
  if (!text) return false;
  if (TRANSACTIONAL_ANCHOR_PATTERNS.some((pattern) => pattern.test(text))) return false;

  if (REPURCHASE_MARKETING_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  const campaignSignals = PROMOTIONAL_CAMPAIGN_PATTERNS
    .filter((pattern) => pattern.test(text))
    .length;
  return campaignSignals >= 2;
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

  if (isPromotionalCommerceNoise(email)) {
    return {
      relevant: false,
      reasons: ['excluded_promotional_or_repurchase_marketing'],
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
