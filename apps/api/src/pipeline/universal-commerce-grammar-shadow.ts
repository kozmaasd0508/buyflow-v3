import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import {
  evaluateUniversalCommerceGrammarV1,
  UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION,
} from '../ingestion/universal-commerce-grammar-v1.js';

export interface UniversalCommerceGrammarShadowDiagnostic {
  version: typeof UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  lifecycle: string;
  eventType: string | null;
  decision: 'actionable' | 'review' | 'blocked';
  confidence: number;
  evidence: string[];
  negativeEvidence: string[];
}

/**
 * Privacy-reduced, read-only observer. It intentionally exposes only semantic
 * evidence names and never raw order, tracking, invoice, payment or email data.
 */
export function runUniversalCommerceGrammarShadow(
  email: NormalizedEmail,
): UniversalCommerceGrammarShadowDiagnostic {
  const result = evaluateUniversalCommerceGrammarV1(buildEmailDocumentV1(email));

  return {
    version: UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    lifecycle: result.lifecycle,
    eventType: result.eventType,
    decision: result.decision,
    confidence: result.confidence,
    evidence: result.positiveEvidence,
    negativeEvidence: result.negativeEvidence,
  };
}
