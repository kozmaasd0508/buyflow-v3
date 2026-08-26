import { isCarrierSenderDomain } from '../email/sender-role.js';
import {
  isPublicMailboxSenderDomain,
  isSharedPlatformSenderDomain,
} from '../ingestion/generic-order-confirmation-adapter.js';
import type { CanonicalEvent } from './types.js';

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/**
 * Returns a narrow exact sender-domain namespace for merchant-origin events
 * when no canonical merchant registry identity exists yet.
 *
 * This is intentionally not a merchant id. Public mailboxes, shared commerce
 * infrastructure and carrier domains are refused so they can never collapse
 * unrelated shops into one namespace.
 */
export function deriveMerchantSenderNamespace(
  event: Pick<CanonicalEvent, 'sourceRole' | 'senderDomain'>,
): string | null {
  if (event.sourceRole !== 'merchant' || !event.senderDomain) return null;
  const domain = normalizeDomain(event.senderDomain);
  if (!domain) return null;
  if (isPublicMailboxSenderDomain(domain)) return null;
  if (isSharedPlatformSenderDomain(domain)) return null;
  if (isCarrierSenderDomain(domain)) return null;
  return `sender-domain:${domain}`;
}
