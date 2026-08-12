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

function searchableText(email: NormalizedEmail): string {
  const attachmentNames = email.attachments.map((attachment) => attachment.filename).join(' ');
  return `${email.subject ?? ''} ${email.snippet ?? ''} ${attachmentNames}`.toLowerCase();
}

export function filterCommerceEmail(email: NormalizedEmail): CommerceEmailFilterDecision {
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
