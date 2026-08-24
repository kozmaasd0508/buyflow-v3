import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import {
  composeUniversalCommerceEventV1,
  UNIVERSAL_COMMERCE_COMPOSITION_V1_VERSION,
} from '../ingestion/universal-commerce-composition-v1.js';
import {
  evaluateUniversalCommerceGrammarV1,
  UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION,
} from '../ingestion/universal-commerce-grammar-v1.js';
import {
  evaluateUniversalCommerceSemanticsV1,
  UNIVERSAL_COMMERCE_SEMANTICS_V1_VERSION,
} from '../ingestion/universal-commerce-semantics-v1.js';

export interface UniversalCommerceGrammarShadowDiagnostic {
  version: typeof UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION;
  semanticVersion: typeof UNIVERSAL_COMMERCE_SEMANTICS_V1_VERSION;
  compositionVersion: typeof UNIVERSAL_COMMERCE_COMPOSITION_V1_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  lifecycle: string;
  eventType: string | null;
  decision: 'actionable' | 'review' | 'blocked';
  confidence: number;
  evidence: string[];
  negativeEvidence: string[];
  semanticObjects: string[];
  semanticActions: string[];
  semanticModifiers: string[];
  semanticVisibleEvidence: string[];
  semanticTechnicalEvidence: string[];
  semanticCorroboratedEvidence: string[];
  compositionLifecycle: string;
  compositionEventType: string | null;
  compositionDecision: 'actionable' | 'review' | 'blocked';
  compositionConfidence: number;
  compositionEvidence: string[];
  compositionNegativeEvidence: string[];
}

/**
 * Privacy-reduced, read-only observer. It intentionally exposes only semantic
 * evidence names and never raw order, tracking, invoice, payment or email data.
 */
export function runUniversalCommerceGrammarShadow(
  email: NormalizedEmail,
): UniversalCommerceGrammarShadowDiagnostic {
  const document = buildEmailDocumentV1(email);
  const result = evaluateUniversalCommerceGrammarV1(document);
  const semantics = evaluateUniversalCommerceSemanticsV1(document);
  const composition = composeUniversalCommerceEventV1(document, semantics);

  return {
    version: UNIVERSAL_COMMERCE_GRAMMAR_V1_VERSION,
    semanticVersion: UNIVERSAL_COMMERCE_SEMANTICS_V1_VERSION,
    compositionVersion: UNIVERSAL_COMMERCE_COMPOSITION_V1_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    lifecycle: result.lifecycle,
    eventType: result.eventType,
    decision: result.decision,
    confidence: result.confidence,
    evidence: result.positiveEvidence,
    negativeEvidence: result.negativeEvidence,
    semanticObjects: semantics.objects,
    semanticActions: semantics.actions,
    semanticModifiers: semantics.modifiers,
    semanticVisibleEvidence: semantics.visibleEvidence,
    semanticTechnicalEvidence: semantics.technicalEvidence,
    semanticCorroboratedEvidence: semantics.corroboratedEvidence,
    compositionLifecycle: composition.lifecycle,
    compositionEventType: composition.eventType,
    compositionDecision: composition.decision,
    compositionConfidence: composition.confidence,
    compositionEvidence: composition.evidence,
    compositionNegativeEvidence: composition.negativeEvidence,
  };
}
