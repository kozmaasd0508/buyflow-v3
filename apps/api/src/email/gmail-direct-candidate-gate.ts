import {
  mailLensSemanticEmailV1,
  normalizeEmailDocumentV1,
} from './normalize-document-v1.js';
import type { NormalizedEmail } from './types.js';
import { parseNormalizedDeterministicEmail } from '../ingestion/normalized-email-deterministic.js';
import { evaluateShoppingEmailPurpose } from '../pipeline/shopping-email-purpose-gate.js';
import { runUniversalCommerceGrammarShadow } from '../pipeline/universal-commerce-grammar-shadow.js';

const TRANSACTIONAL_SCHEMA_TYPES = new Set([
  'Order',
  'ParcelDelivery',
  'Invoice',
  'OrderAction',
  'TrackAction',
  'DeliveryEvent',
  'ReceiveAction',
  'ReturnAction',
  'CancelAction',
]);

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
 * Every semantic consumer uses the same MailLens-normalized current body view.
 */
export function evaluateGmailDirectCandidate(
  email: NormalizedEmail,
): GmailDirectCandidateDecision {
  const mailLens = normalizeEmailDocumentV1(email);
  const semanticEmail = mailLensSemanticEmailV1(email);
  const purpose = evaluateShoppingEmailPurpose(semanticEmail);
  if (purpose.action === 'ignore') {
    return { action: 'ignore', reason: 'proven_non_commerce' };
  }

  if (mailLens.folders.some((label) => label.toUpperCase() === 'CATEGORY_PURCHASES')) {
    return { action: 'observe', reason: 'gmail_purchases_category' };
  }

  if (mailLens.structuredData.some(
    (record) => record.schemaType && TRANSACTIONAL_SCHEMA_TYPES.has(record.schemaType),
  )) {
    return { action: 'observe', reason: 'structured_commerce_markup' };
  }

  if (parseNormalizedDeterministicEmail(semanticEmail)) {
    return { action: 'observe', reason: 'deterministic_commerce_match' };
  }

  const semantic = runUniversalCommerceGrammarShadow(semanticEmail);
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
