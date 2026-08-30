import type { NormalizedEmail } from './types.js';
import { auditStructuredMarkup } from './structured-markup.js';
import { parseNormalizedDeterministicEmail } from '../ingestion/normalized-email-deterministic.js';
import { evaluateShoppingEmailPurpose } from '../pipeline/shopping-email-purpose-gate.js';
import { runUniversalCommerceGrammarShadow } from '../pipeline/universal-commerce-grammar-shadow.js';

export interface GmailDirectCandidateDecision {
  action: 'observe' | 'ignore';
  reason:
    | 'proven_non_commerce'
    | 'gmail_purchases_category'
    | 'structured_commerce_markup'
    | 'deterministic_commerce_match'
    | 'universal_commerce_semantics'
    | 'no_positive_commerce_evidence';
}

/**
 * Privacy boundary for a directly connected personal mailbox.
 *
 * Unlike the dedicated @buyflow.hu shopping address, an unknown Gmail message
 * must NOT be persisted just because BuyFlow cannot classify it. We first need
 * positive commerce evidence. This allows a broad Gmail history/watch source
 * without turning BuyFlow into a copy of the user's general mailbox.
 */
export function evaluateGmailDirectCandidate(
  email: NormalizedEmail,
): GmailDirectCandidateDecision {
  const purpose = evaluateShoppingEmailPurpose(email);
  if (purpose.action === 'ignore') {
    return { action: 'ignore', reason: 'proven_non_commerce' };
  }

  if ((email.folders ?? []).some((label) => label.toUpperCase() === 'CATEGORY_PURCHASES')) {
    return { action: 'observe', reason: 'gmail_purchases_category' };
  }

  if (email.bodyHtml) {
    const markup = auditStructuredMarkup(email.bodyHtml);
    if (markup.commerceTypes.length > 0) {
      return { action: 'observe', reason: 'structured_commerce_markup' };
    }
  }

  if (parseNormalizedDeterministicEmail(email)) {
    return { action: 'observe', reason: 'deterministic_commerce_match' };
  }

  const semantic = runUniversalCommerceGrammarShadow(email);
  const hasUniversalEvent = Boolean(
    semantic.eventType
    || semantic.compositionEventType
    || semantic.compositionV11Observations.some(
      (observation) => observation.eventType && observation.decision !== 'blocked',
    ),
  );
  if (hasUniversalEvent) {
    return { action: 'observe', reason: 'universal_commerce_semantics' };
  }

  return { action: 'ignore', reason: 'no_positive_commerce_evidence' };
}
