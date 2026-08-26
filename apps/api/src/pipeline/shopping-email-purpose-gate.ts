import type { NormalizedEmail } from '../email/types.js';
import {
  isExpressOneOutboundPickupNoise,
  isPromotionalCommerceNoise,
} from '../ingestion/commerce-email-filter.js';
import { isProviderLifecycleV6Noise } from '../ingestion/provider-lifecycle-v6-adapter.js';

export type ShoppingEmailPurposeAction = 'continue' | 'ignore';

export interface ShoppingEmailPurposeDecision {
  action: ShoppingEmailPurposeAction;
  reason: string;
}

/**
 * The BuyFlow address is a shopping-purpose inbox, not a general mailbox.
 *
 * This gate intentionally ignores only messages that are already proven to be
 * non-purchase noise by deterministic rules. Unknown messages are NOT dropped:
 * they continue to the parser and may become REVIEW so a new merchant/template
 * cannot silently lose a real purchase.
 */
export function evaluateShoppingEmailPurpose(
  email: NormalizedEmail,
): ShoppingEmailPurposeDecision {
  if (isExpressOneOutboundPickupNoise(email)) {
    return {
      action: 'ignore',
      reason: 'shopping_email_excluded_outbound_logistics_service',
    };
  }

  if (isProviderLifecycleV6Noise(email)) {
    return {
      action: 'ignore',
      reason: 'shopping_email_excluded_known_non_purchase_provider_message',
    };
  }

  if (isPromotionalCommerceNoise(email)) {
    return {
      action: 'ignore',
      reason: 'shopping_email_excluded_promotional_or_repurchase_marketing',
    };
  }

  return {
    action: 'continue',
    reason: 'shopping_email_not_proven_non_purchase',
  };
}
