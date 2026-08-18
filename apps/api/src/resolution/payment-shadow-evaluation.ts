import {
  normalizeAuthenticatedPaymentProviderEmail,
  type AuthenticatedPaymentProviderEmail,
} from '../ingestion/payment-provider-shadow-normalizer.js';
import {
  resolvePaymentShadow,
  type PaymentShadowEvidence,
  type PaymentShadowPurchaseIdentity,
  type PaymentShadowResolutionCandidate,
} from './payment-shadow-resolution.js';

export interface PaymentShadowEvaluation {
  evidence: PaymentShadowEvidence;
  resolution: PaymentShadowResolutionCandidate;
  wouldWrite: false;
}

export type PaymentShadowScoreBand = 'none' | 'weak' | 'review' | 'strict';

export interface PaymentShadowPrivacyDiagnostic {
  provider: string;
  context: PaymentShadowEvidence['context'];
  decision: PaymentShadowResolutionCandidate['decision'];
  scoreBand: PaymentShadowScoreBand;
  hasMerchantDomainHint: boolean;
  hasMerchantNameHint: boolean;
  hasMerchantReference: boolean;
  hasAmountCurrency: boolean;
  strictSignalCount: number;
  ambiguous: boolean;
  wouldWrite: false;
}

function scoreBand(score: number): PaymentShadowScoreBand {
  if (score <= 0) return 'none';
  if (score < 80) return 'weak';
  if (score < 170) return 'review';
  return 'strict';
}

export function evaluatePaymentShadow(
  email: AuthenticatedPaymentProviderEmail,
  purchases: PaymentShadowPurchaseIdentity[],
): PaymentShadowEvaluation | null {
  const evidence = normalizeAuthenticatedPaymentProviderEmail(email);
  if (!evidence) return null;

  const resolution = resolvePaymentShadow(evidence, purchases);
  return {
    evidence,
    resolution,
    wouldWrite: false,
  };
}

export function paymentShadowPrivacyDiagnostic(
  evaluation: PaymentShadowEvaluation,
): PaymentShadowPrivacyDiagnostic {
  const { evidence, resolution } = evaluation;
  const strictSignalCount = [
    resolution.reasons.includes('exact_merchant_domain_match'),
    resolution.reasons.includes('exact_amount_currency_match'),
    resolution.reasons.includes('within_2_days'),
  ].filter(Boolean).length;

  return {
    provider: evidence.provider,
    context: evidence.context,
    decision: resolution.decision,
    scoreBand: scoreBand(resolution.score),
    hasMerchantDomainHint: Boolean(evidence.merchantDomainHint),
    hasMerchantNameHint: Boolean(evidence.merchantNameHint),
    hasMerchantReference: Boolean(evidence.merchantReference),
    hasAmountCurrency: evidence.amount !== null && Boolean(evidence.currency),
    strictSignalCount,
    ambiguous: resolution.reasons.includes('multiple_strict_payment_purchase_candidates'),
    wouldWrite: false,
  };
}
