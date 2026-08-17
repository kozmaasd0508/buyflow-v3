import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { parseDeterministicLifecycleEmail } from '../ingestion/deterministic-lifecycle-parser.js';
import { filterCommerceEmail } from '../ingestion/commerce-email-filter.js';
import {
  observeGenericCommerceShadowEmail,
  type GenericCommerceShadowDiagnostic,
} from '../protocols/generic-commerce-shadow.js';
import { protocolDomainMatchesTrustedSuffix } from '../protocols/detect.js';
import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type { ProtocolProfile } from '../protocols/types.js';

const PAGE_SIZE = 20;
const MAX_MESSAGES = Math.min(
  Math.max(Number.parseInt(process.env.GENERIC_COMMERCE_AUDIT_MAX_MESSAGES ?? '10000', 10) || 10_000, 1),
  10_000,
);
const FULL_MESSAGE_CONCURRENCY = 2;
const FULL_MESSAGE_MIN_INTERVAL_MS = 500;
const MAX_RATE_LIMIT_RETRIES = 6;
const BODY_MAX_CHARS = 80_000;

type ErrorLike = {
  statusCode?: unknown;
  headers?: unknown;
};

type CandidateEvaluation = {
  row: GenericCommerceShadowDiagnostic;
  lifecycleSuppressed: boolean;
  explicitProfileSender: boolean;
  purchaseCategory: boolean;
  commerceFilterReasons: string[];
};

type FingerprintStats = {
  count: number;
  pipelineEligibleCount: number;
  unprofiledPipelineEligibleCount: number;
  minConfidence: number;
  maxConfidence: number;
  strongCount: number;
  mediumCount: number;
  exploratoryCount: number;
  orderNumberCount: number;
  totalCount: number;
  currencyCount: number;
  paymentMethodCount: number;
  shippingMethodCount: number;
  productRowMessages: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusCodeOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as ErrorLike).statusCode;
  return typeof value === 'number' ? value : null;
}

function retryAfterMsOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers = (error as ErrorLike).headers;
  if (!headers || typeof headers !== 'object') return null;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  const seconds = typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

async function withRateLimitRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (statusCodeOf(error) !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      const retryAfterMs = retryAfterMsOf(error);
      const exponentialMs = Math.min(60_000, 5_000 * (2 ** attempt));
      const jitterMs = Math.floor(Math.random() * 1_000);
      onRetry();
      attempt += 1;
      await sleep(Math.max(retryAfterMs ?? 0, exponentialMs) + jitterMs);
    }
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
  return results;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

function metadataCouldContainOrderConfirmation(email: NormalizedEmail): boolean {
  const text = normalizeText(`${email.subject ?? ''}\n${email.snippet ?? ''}`);
  if (!text.trim()) return false;

  const orderLexeme = /\b(?:order|rendel\w*|megrendel\w*|bestell\w*|commande|pedido)\b/i.test(text);
  if (!orderLexeme) return false;

  const confirmationCue = /\b(?:confirm\w*|visszaig\w*|koszon\w*|thanks?|received|beerk\w*|rogzit\w*|bestat\w*|merci|gracias)\b/i.test(text);
  const subjectIdentifierCue = /\b(?:order|rendel\w*|megrendel\w*|bestell\w*|commande|pedido)[^\n]{0,24}\d{3,}/i.test(text);
  return confirmationCue || subjectIdentifierCue;
}

function domainOf(address: string): string {
  const normalized = address.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at >= 0 ? normalized.slice(at + 1) : '';
}

function explicitSenderProfile(profile: ProtocolProfile): boolean {
  return profile.sender_domains.length > 0 || (profile.sender_addresses?.length ?? 0) > 0;
}

function senderMayMatchProfile(message: NormalizedEmail, profile: ProtocolProfile): boolean {
  const senderAddresses = message.from
    .map((sender) => sender.email.trim().toLowerCase())
    .filter(Boolean);
  const senderDomains = senderAddresses.map(domainOf).filter(Boolean);

  if (profile.sender_domains.length > 0) {
    const domainMatch = senderDomains.some((candidate) =>
      profile.sender_domains.some((trusted) =>
        protocolDomainMatchesTrustedSuffix(candidate, trusted),
      ),
    );
    if (!domainMatch) return false;
  }

  if ((profile.sender_addresses?.length ?? 0) > 0) {
    const allowed = new Set(
      profile.sender_addresses!.map((address) => address.trim().toLowerCase()),
    );
    if (!senderAddresses.some((address) => allowed.has(address))) return false;
  }

  return true;
}

function bodyText(email: NormalizedEmail): string {
  return email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, BODY_MAX_CHARS)
    : (email.snippet ?? '').trim().slice(0, BODY_MAX_CHARS);
}

function lifecycleWouldPreemptGeneric(email: NormalizedEmail): boolean {
  const senderEmails = email.from.map((sender) => sender.email.trim().toLowerCase()).filter(Boolean);
  const senderDomains = senderEmails.map(domainOf).filter(Boolean);
  return parseDeterministicLifecycleEmail({
    senderDomains,
    senderEmails,
    subject: email.subject,
    bodyText: bodyText(email),
  }) !== null;
}

function hasPurchaseCategory(email: NormalizedEmail): boolean {
  return email.folders.some((folder) => folder.toUpperCase() === 'CATEGORY_PURCHASES');
}

function tier(row: GenericCommerceShadowDiagnostic): 'strong' | 'medium' | 'exploratory' {
  const evidence = row.evidence_present;
  if (
    row.confidence >= 0.97 &&
    evidence.order_number &&
    evidence.total &&
    (evidence.payment_method || evidence.shipping_method || evidence.product_rows > 0)
  ) {
    return 'strong';
  }
  if (row.confidence >= 0.95) return 'medium';
  return 'exploratory';
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedNumberObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function emptyFingerprintStats(confidence: number): FingerprintStats {
  return {
    count: 0,
    pipelineEligibleCount: 0,
    unprofiledPipelineEligibleCount: 0,
    minConfidence: confidence,
    maxConfidence: confidence,
    strongCount: 0,
    mediumCount: 0,
    exploratoryCount: 0,
    orderNumberCount: 0,
    totalCount: 0,
    currencyCount: 0,
    paymentMethodCount: 0,
    shippingMethodCount: 0,
    productRowMessages: 0,
  };
}

function addFingerprint(
  map: Map<string, FingerprintStats>,
  evaluation: CandidateEvaluation,
) {
  const { row } = evaluation;
  const key = row.sender_domain_fingerprint;
  const stats = map.get(key) ?? emptyFingerprintStats(row.confidence);
  const candidateTier = tier(row);
  stats.count += 1;
  if (!evaluation.lifecycleSuppressed) stats.pipelineEligibleCount += 1;
  if (!evaluation.lifecycleSuppressed && !evaluation.explicitProfileSender) {
    stats.unprofiledPipelineEligibleCount += 1;
  }
  stats.minConfidence = Math.min(stats.minConfidence, row.confidence);
  stats.maxConfidence = Math.max(stats.maxConfidence, row.confidence);
  stats[`${candidateTier}Count`] += 1;
  if (row.evidence_present.order_number) stats.orderNumberCount += 1;
  if (row.evidence_present.total) stats.totalCount += 1;
  if (row.evidence_present.currency) stats.currencyCount += 1;
  if (row.evidence_present.payment_method) stats.paymentMethodCount += 1;
  if (row.evidence_present.shipping_method) stats.shippingMethodCount += 1;
  if (row.evidence_present.product_rows > 0) stats.productRowMessages += 1;
  map.set(key, stats);
}

function topFingerprints(map: Map<string, FingerprintStats>, unprofiledOnly = false) {
  return [...map.entries()]
    .filter(([, stats]) => !unprofiledOnly || stats.unprofiledPipelineEligibleCount > 0)
    .sort((a, b) => {
      const aPrimary = unprofiledOnly ? a[1].unprofiledPipelineEligibleCount : a[1].count;
      const bPrimary = unprofiledOnly ? b[1].unprofiledPipelineEligibleCount : b[1].count;
      return bPrimary - aPrimary || b[1].count - a[1].count || a[0].localeCompare(b[0]);
    })
    .slice(0, 20)
    .map(([fingerprint, stats]) => ({ fingerprint, ...stats }));
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });
  const explicitProfiles = [...registeredTestProtocolProfiles()].filter(explicitSenderProfile);

  const seenMessageIds = new Set<string>();
  const fingerprints = new Map<string, FingerprintStats>();
  const reasonCounts = new Map<string, number>();
  const filterReasonCounts = new Map<string, number>();
  const tierCounts = new Map<string, number>();
  const confidenceCounts = new Map<string, number>();
  const evidenceCombinationCounts = new Map<string, number>();

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let rateLimitRetries = 0;
  let listMessagesWithBody = 0;
  let metadataFallbackCandidates = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let rawGenericCandidates = 0;
  let lifecycleSuppressedGenericCandidates = 0;
  let pipelineEligibleGenericCandidates = 0;
  let explicitProfileSenderCandidates = 0;
  let unprofiledPipelineEligibleCandidates = 0;
  let purchaseCategoryCandidates = 0;
  let strongUnprofiledPipelineCandidates = 0;

  do {
    const page = await withRateLimitRetry(
      () => provider.searchMessages({
        query: env.EMAIL_DISCOVERY_QUERY,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      () => { rateLimitRetries += 1; },
    );
    pages += 1;

    const evaluations: CandidateEvaluation[] = [];
    const fallbackFetches: NormalizedEmail[] = [];

    for (const message of page.messages) {
      if (seenMessageIds.has(message.providerMessageId)) continue;
      if (seenMessageIds.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }
      seenMessageIds.add(message.providerMessageId);

      if (message.bodyHtml && message.bodyHtml.trim().length > 0) {
        listMessagesWithBody += 1;
        const row = observeGenericCommerceShadowEmail(message);
        if (row) {
          evaluations.push({
            row,
            lifecycleSuppressed: lifecycleWouldPreemptGeneric(message),
            explicitProfileSender: explicitProfiles.some((profile) => senderMayMatchProfile(message, profile)),
            purchaseCategory: hasPurchaseCategory(message),
            commerceFilterReasons: filterCommerceEmail(message).reasons,
          });
        }
      } else if (metadataCouldContainOrderConfirmation(message)) {
        metadataFallbackCandidates += 1;
        fallbackFetches.push(message);
      }
    }

    const fetchedEvaluations = await mapWithConcurrency(
      fallbackFetches,
      FULL_MESSAGE_CONCURRENCY,
      async (metadata): Promise<CandidateEvaluation | null> => {
        fullMessageFetches += 1;
        try {
          const full = await withRateLimitRetry(
            () => provider.getMessage(metadata.providerMessageId),
            () => { rateLimitRetries += 1; },
          );
          const row = observeGenericCommerceShadowEmail(full);
          if (!row) return null;
          return {
            row,
            lifecycleSuppressed: lifecycleWouldPreemptGeneric(full),
            explicitProfileSender: explicitProfiles.some((profile) => senderMayMatchProfile(full, profile)),
            purchaseCategory: hasPurchaseCategory(full),
            commerceFilterReasons: filterCommerceEmail(full).reasons,
          };
        } catch {
          fullMessageFetchFailures += 1;
          return null;
        } finally {
          await sleep(FULL_MESSAGE_MIN_INTERVAL_MS);
        }
      },
    );

    for (const evaluation of [...evaluations, ...fetchedEvaluations.filter((row): row is CandidateEvaluation => row !== null)]) {
      rawGenericCandidates += 1;
      addFingerprint(fingerprints, evaluation);

      const candidateTier = tier(evaluation.row);
      bump(tierCounts, candidateTier);
      bump(confidenceCounts, evaluation.row.confidence.toFixed(2));
      for (const reason of evaluation.row.reasons) bump(reasonCounts, reason);
      for (const reason of evaluation.commerceFilterReasons) bump(filterReasonCounts, reason);

      const evidence = evaluation.row.evidence_present;
      const evidenceKey = [
        'order',
        evidence.total ? 'total' : null,
        evidence.payment_method ? 'payment' : null,
        evidence.shipping_method ? 'shipping' : null,
        evidence.product_rows > 0 ? 'products' : null,
      ].filter(Boolean).join('+');
      bump(evidenceCombinationCounts, evidenceKey);

      if (evaluation.lifecycleSuppressed) {
        lifecycleSuppressedGenericCandidates += 1;
        continue;
      }

      pipelineEligibleGenericCandidates += 1;
      if (evaluation.purchaseCategory) purchaseCategoryCandidates += 1;
      if (evaluation.explicitProfileSender) {
        explicitProfileSenderCandidates += 1;
      } else {
        unprofiledPipelineEligibleCandidates += 1;
        if (candidateTier === 'strong') strongUnprofiledPipelineCandidates += 1;
      }
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  const repeatedFingerprints = [...fingerprints.values()].filter((stats) => stats.count >= 2).length;
  const repeatedUnprofiledFingerprints = [...fingerprints.values()].filter(
    (stats) => stats.unprofiledPipelineEligibleCount >= 2,
  ).length;
  const distinctUnprofiledPipelineFingerprints = [...fingerprints.values()].filter(
    (stats) => stats.unprofiledPipelineEligibleCount > 0,
  ).length;

  console.log(JSON.stringify({
    mode: 'read_only_generic_commerce_unknown_merchant_audit',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
    safety: {
      databaseWrites: false,
      productionRegistryUsed: false,
      automaticPurchaseWrites: false,
      genericEvidenceWriteEligible: false,
      rawEmailOutput: false,
      subjectOutput: false,
      messageIdOutput: false,
      senderAddressOutput: false,
      senderDomainOutput: false,
      orderIdOutput: false,
      productNameOutput: false,
      amountOutput: false,
    },
    interpretation: {
      rawGenericCandidate: 'central deterministic commerce parser fell through to generic-order-confirmation-v1.2',
      pipelineEligibleGenericCandidate: 'raw generic candidate not preempted by the legacy deterministic lifecycle parser',
      unprofiledCandidate: 'pipeline-eligible generic candidate whose sender does not match any explicit test-profile sender identity',
      strongIsPrecisionProxyOnly: true,
      manualReviewStillRequiredBeforeAnyWritePromotion: true,
    },
    scope: {
      totalMessages: seenMessageIds.size,
      pages,
      maxMessagesSafetyCap: MAX_MESSAGES,
      truncated,
      listMessagesWithBody,
      listMessagesWithoutBody: seenMessageIds.size - listMessagesWithBody,
      metadataFallbackCandidates,
      fullMessageFetches,
      fullMessageFetchFailures,
      rateLimitRetries,
      explicitTestSenderProfiles: explicitProfiles.length,
    },
    candidates: {
      rawGenericCandidates,
      lifecycleSuppressedGenericCandidates,
      pipelineEligibleGenericCandidates,
      explicitProfileSenderCandidates,
      unprofiledPipelineEligibleCandidates,
      strongUnprofiledPipelineCandidates,
      purchaseCategoryCandidates,
      distinctGenericFingerprints: fingerprints.size,
      repeatedGenericFingerprints: repeatedFingerprints,
      distinctUnprofiledPipelineFingerprints,
      repeatedUnprofiledPipelineFingerprints,
    },
    candidateTierCounts: sortedNumberObject(tierCounts),
    confidenceCounts: sortedNumberObject(confidenceCounts),
    evidenceCombinationCounts: sortedNumberObject(evidenceCombinationCounts),
    parserReasonCounts: sortedNumberObject(reasonCounts),
    commerceFilterReasonCounts: sortedNumberObject(filterReasonCounts),
    topGenericFingerprints: topFingerprints(fingerprints),
    topUnprofiledPipelineFingerprints: topFingerprints(fingerprints, true),
  }, null, 2));
}

main().catch((error) => {
  console.error('Nylas generic commerce audit failed:', error);
  process.exit(1);
});
