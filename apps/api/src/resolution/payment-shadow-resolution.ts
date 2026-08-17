export type PaymentShadowContext =
  | 'purchase'
  | 'unknown'
  | 'recurring_or_subscription'
  | 'service_or_billing';

export interface PaymentShadowEvidence {
  sourceEmailId: string;
  userId: string;
  provider: string;
  paymentReference: string | null;
  merchantDomainHint: string | null;
  merchantNameHint: string | null;
  merchantReference: string | null;
  amount: number | null;
  currency: string | null;
  receivedAt: string;
  confidence: number;
  context: PaymentShadowContext;
}

export interface PaymentShadowPurchaseIdentity {
  purchaseId: string;
  userId: string;
  merchantDomain: string | null;
  merchantName: string | null;
  orderNumber: string | null;
  totalAmount: number | null;
  currency: string | null;
  orderedAt: string | null;
}

export type PaymentShadowResolutionDecision =
  | 'shadow_linkable'
  | 'review'
  | 'unmatched';

export interface PaymentShadowResolutionCandidate {
  sourceEmailId: string;
  userId: string;
  purchaseId: string | null;
  decision: PaymentShadowResolutionDecision;
  score: number;
  runnerUpScore: number;
  reasons: string[];
  wouldWrite: false;
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
    .replace(/\.$/, '');
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:kft|zrt|bt|nyrt|ltd|limited|inc|llc|gmbh)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeCurrency(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'FT') return 'HUF';
  return normalized;
}

function amountMatches(
  evidenceAmount: number | null,
  evidenceCurrency: string | null,
  purchaseAmount: number | null,
  purchaseCurrency: string | null,
): boolean {
  if (
    evidenceAmount === null ||
    purchaseAmount === null ||
    !Number.isFinite(evidenceAmount) ||
    !Number.isFinite(purchaseAmount)
  ) return false;

  const leftCurrency = normalizeCurrency(evidenceCurrency);
  const rightCurrency = normalizeCurrency(purchaseCurrency);
  if (!leftCurrency || leftCurrency !== rightCurrency) return false;

  const tolerance = leftCurrency === 'HUF' ? 1 : 0.01;
  return Math.abs(evidenceAmount - purchaseAmount) <= tolerance;
}

function dayDistance(receivedAt: string, orderedAt: string | null): number | null {
  if (!orderedAt) return null;
  const received = Date.parse(receivedAt);
  const ordered = Date.parse(orderedAt);
  if (!Number.isFinite(received) || !Number.isFinite(ordered)) return null;
  return Math.abs(received - ordered) / 86_400_000;
}

function isNonPurchaseContext(context: PaymentShadowContext): boolean {
  return context === 'recurring_or_subscription' || context === 'service_or_billing';
}

export function resolvePaymentShadow(
  evidence: PaymentShadowEvidence,
  purchases: PaymentShadowPurchaseIdentity[],
): PaymentShadowResolutionCandidate {
  if (isNonPurchaseContext(evidence.context)) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: null,
      decision: 'unmatched',
      score: 0,
      runnerUpScore: 0,
      reasons: ['explicit_non_purchase_payment_context'],
      wouldWrite: false,
    };
  }

  const merchantDomain = normalizeDomain(evidence.merchantDomainHint);
  const merchantName = normalizeText(evidence.merchantNameHint);
  const merchantReference = normalizeIdentifier(evidence.merchantReference);

  const scored = purchases
    .filter((purchase) => purchase.userId === evidence.userId)
    .map((purchase) => {
      let score = 0;
      const reasons: string[] = [];

      const purchaseDomain = normalizeDomain(purchase.merchantDomain);
      const purchaseName = normalizeText(purchase.merchantName);
      const purchaseOrder = normalizeIdentifier(purchase.orderNumber);

      const exactDomain = Boolean(
        merchantDomain && purchaseDomain && merchantDomain === purchaseDomain,
      );
      if (exactDomain) {
        score += 90;
        reasons.push('exact_merchant_domain_match');
      }

      const exactName = Boolean(
        merchantName && purchaseName && merchantName === purchaseName,
      );
      if (exactName) {
        score += 40;
        reasons.push('exact_merchant_name_match');
      }

      const exactAmountCurrency = amountMatches(
        evidence.amount,
        evidence.currency,
        purchase.totalAmount,
        purchase.currency,
      );
      if (exactAmountCurrency) {
        score += 60;
        reasons.push('exact_amount_currency_match');
      }

      // Provider/merchant references are deliberately only corroborating evidence.
      // They never establish purchase identity by themselves because providers such
      // as SimplePay and Barion explicitly expose merchant-owned references whose
      // semantics vary between merchants and non-commerce payment contexts.
      const referenceMatches = Boolean(
        merchantReference && purchaseOrder && merchantReference === purchaseOrder,
      );
      if (referenceMatches) {
        score += 30;
        reasons.push('merchant_reference_matches_existing_order');
      }

      const distance = dayDistance(evidence.receivedAt, purchase.orderedAt);
      const withinTwoDays = distance !== null && distance <= 2;
      const hasIndependentSignal = exactDomain || exactName || exactAmountCurrency || referenceMatches;

      // Time is only corroborating evidence. A nearby purchase cannot become a
      // candidate solely because it happened close to the provider receipt.
      if (hasIndependentSignal && withinTwoDays) {
        score += 20;
        reasons.push('within_2_days');
      } else if (hasIndependentSignal && distance !== null && distance <= 7) {
        score += 8;
        reasons.push('within_7_days');
      }

      return {
        purchase,
        score,
        reasons,
        exactDomain,
        exactName,
        exactAmountCurrency,
        withinTwoDays,
      };
    })
    .sort((a, b) => b.score - a.score || a.purchase.purchaseId.localeCompare(b.purchase.purchaseId));

  const best = scored[0];
  const runnerUpScore = scored[1]?.score ?? 0;
  if (!best || best.score === 0) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: null,
      decision: 'unmatched',
      score: 0,
      runnerUpScore,
      reasons: ['no_matching_purchase_signals'],
      wouldWrite: false,
    };
  }

  const strictCandidates = scored.filter((candidate) =>
    candidate.exactDomain &&
    candidate.exactAmountCurrency &&
    candidate.withinTwoDays,
  );

  if (strictCandidates.length > 1) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: best.purchase.purchaseId,
      decision: 'review',
      score: best.score,
      runnerUpScore,
      reasons: [...best.reasons, 'multiple_strict_payment_purchase_candidates'],
      wouldWrite: false,
    };
  }

  if (
    strictCandidates.length === 1 &&
    strictCandidates[0]!.purchase.purchaseId === best.purchase.purchaseId
  ) {
    if (evidence.confidence < 0.95) {
      return {
        sourceEmailId: evidence.sourceEmailId,
        userId: evidence.userId,
        purchaseId: best.purchase.purchaseId,
        decision: 'review',
        score: best.score,
        runnerUpScore,
        reasons: [...best.reasons, 'payment_evidence_confidence_below_shadow_link_threshold'],
        wouldWrite: false,
      };
    }

    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: best.purchase.purchaseId,
      decision: 'shadow_linkable',
      score: best.score,
      runnerUpScore,
      reasons: [...best.reasons, 'shadow_only_no_write_authority'],
      wouldWrite: false,
    };
  }

  const hasMerchantSignal = best.exactDomain || best.exactName;
  const hasFinancialSignal = best.exactAmountCurrency;
  if (best.score >= 80 && (hasMerchantSignal || hasFinancialSignal)) {
    return {
      sourceEmailId: evidence.sourceEmailId,
      userId: evidence.userId,
      purchaseId: best.purchase.purchaseId,
      decision: 'review',
      score: best.score,
      runnerUpScore,
      reasons: [...best.reasons, 'insufficient_strict_payment_link_evidence'],
      wouldWrite: false,
    };
  }

  return {
    sourceEmailId: evidence.sourceEmailId,
    userId: evidence.userId,
    purchaseId: null,
    decision: 'unmatched',
    score: best.score,
    runnerUpScore,
    reasons: [...best.reasons, 'insufficient_payment_match_evidence'],
    wouldWrite: false,
  };
}
