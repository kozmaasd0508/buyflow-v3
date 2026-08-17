import { env, requireNylasSmokeGrantId } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { detectProtocolEvidence } from '../protocols/detect.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';
import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type { ProtocolProfile } from '../protocols/types.js';
import {
  evaluatePaymentShadow,
  paymentShadowPrivacyDiagnostic,
} from '../resolution/payment-shadow-evaluation.js';
import type { PaymentShadowPurchaseIdentity } from '../resolution/payment-shadow-resolution.js';

const PAGE_SIZE = 20;
const MAX_MESSAGES = Math.min(
  Math.max(Number.parseInt(process.env.PAYMENT_SHADOW_AUDIT_MAX_MESSAGES ?? '10000', 10) || 10_000, 1),
  10_000,
);
const MAX_RETRIES = 6;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const PAYMENT_PROFILE_IDS = new Set(['payment.hu.simplepay', 'payment.hu.barion']);
const SIMPLEPAY_ADDRESSES = new Set(['noreply@simplepay.hu']);
const BARION_ADDRESSES = new Set(['barion@barion.com', 'noreply@barion.com']);

type AuditProvider = 'simplepay' | 'barion';
type ErrorLike = { statusCode?: unknown; headers?: unknown };
type PurchaseRow = {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  merchant_name: string | null;
  order_number: string | null;
  total_amount: number | string | null;
  currency: string | null;
  ordered_at: string | null;
};

let stage = 'startup';

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

async function withRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const status = statusCodeOf(error);
      if (status === null || !RETRYABLE_STATUS_CODES.has(status) || attempt >= MAX_RETRIES) throw error;
      const retryAfter = retryAfterMsOf(error) ?? 0;
      const backoff = Math.min(60_000, 5_000 * (2 ** attempt));
      onRetry();
      attempt += 1;
      await sleep(Math.max(retryAfter, backoff) + Math.floor(Math.random() * 750));
    }
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function providerForMessage(message: NormalizedEmail): AuditProvider | null {
  const senders = message.from.map((value) => value.email.trim().toLowerCase()).filter(Boolean);
  if (senders.some((value) => SIMPLEPAY_ADDRESSES.has(value))) return 'simplepay';
  if (senders.some((value) => BARION_ADDRESSES.has(value))) return 'barion';
  return null;
}

function finiteNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function purchaseIdentity(row: PurchaseRow): PaymentShadowPurchaseIdentity {
  return {
    purchaseId: row.id,
    userId: row.user_id,
    merchantDomain: row.merchant_domain,
    merchantName: row.merchant_name,
    orderNumber: row.order_number,
    totalAmount: finiteNumber(row.total_amount),
    currency: row.currency,
    orderedAt: row.ordered_at,
  };
}

async function main(): Promise<void> {
  stage = 'initialize';
  const grantId = requireNylasSmokeGrantId();
  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: grantId });
  const db = getSupabaseAdmin() as any;
  const paymentProfiles = registeredTestProtocolProfiles().filter(
    (profile): profile is ProtocolProfile => PAYMENT_PROFILE_IDS.has(profile.protocol_id),
  );
  if (paymentProfiles.length !== 2) throw new Error('payment_profile_count');

  stage = 'load_connection';
  const { data: connections, error: connectionError } = await db.from('email_connections')
    .select('user_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', grantId)
    .eq('status', 'active')
    .limit(2);
  if (connectionError) throw new Error('connection_select_failed');
  if (!Array.isArray(connections) || connections.length !== 1 || !connections[0]?.user_id) {
    throw new Error('connection_not_unique');
  }
  const userId = String(connections[0].user_id);

  stage = 'load_purchases';
  const { data: purchaseRows, error: purchaseError } = await db.from('purchases')
    .select('id,user_id,merchant_domain,merchant_name,order_number,total_amount,currency,ordered_at')
    .eq('user_id', userId)
    .order('ordered_at', { ascending: true, nullsFirst: true });
  if (purchaseError) throw new Error('purchase_select_failed');
  const purchases = ((purchaseRows ?? []) as PurchaseRow[]).map(purchaseIdentity);
  const strictIdentityReadyPurchases = purchases.filter((purchase) =>
    Boolean(purchase.merchantDomain && purchase.totalAmount !== null && purchase.currency && purchase.orderedAt),
  ).length;

  const seen = new Set<string>();
  const byProvider = new Map<string, number>();
  const authenticatedByProvider = new Map<string, number>();
  const normalizedByProvider = new Map<string, number>();
  const rejectedByProvider = new Map<string, number>();
  const contextCounts = new Map<string, number>();
  const contextByProvider = new Map<string, number>();
  const decisionCounts = new Map<string, number>();
  const decisionByProvider = new Map<string, number>();
  const scoreBandCounts = new Map<string, number>();
  const strictSignalCounts = new Map<string, number>();

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let rateLimitRetries = 0;
  let providerSenderCandidates = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let authenticatedPaymentSuccesses = 0;
  let normalizedEvidence = 0;
  let productionEligibleRows = 0;
  let anyWouldWrite = 0;
  let shadowLinkable = 0;
  let review = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let strictThreeSignalRows = 0;
  let oldestReceivedAt: string | null = null;
  let newestReceivedAt: string | null = null;

  do {
    stage = 'search_mailbox';
    const page = await withRetry(
      () => provider.searchMessages({
        query: env.EMAIL_DISCOVERY_QUERY,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      () => { rateLimitRetries += 1; },
    );
    pages += 1;

    for (const listed of page.messages) {
      if (seen.has(listed.providerMessageId)) continue;
      if (seen.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }
      seen.add(listed.providerMessageId);
      if (!oldestReceivedAt || listed.receivedAt < oldestReceivedAt) oldestReceivedAt = listed.receivedAt;
      if (!newestReceivedAt || listed.receivedAt > newestReceivedAt) newestReceivedAt = listed.receivedAt;

      const auditProvider = providerForMessage(listed);
      if (!auditProvider) continue;
      providerSenderCandidates += 1;
      bump(byProvider, auditProvider);

      stage = 'fetch_provider_message';
      fullMessageFetches += 1;
      let full: NormalizedEmail;
      try {
        full = await withRetry(
          () => provider.getMessage(listed.providerMessageId),
          () => { rateLimitRetries += 1; },
        );
      } catch {
        fullMessageFetchFailures += 1;
        continue;
      }

      stage = 'authenticate_provider_message';
      const input = protocolDetectionInputFromEmail(full);
      const evidenceRows = detectProtocolEvidence(input, paymentProfiles)
        .filter((row) => row.event_candidate === 'PAYMENT_SUCCESS');
      productionEligibleRows += evidenceRows.filter((row) => row.production_eligible).length;
      const expectedProtocolId = auditProvider === 'simplepay'
        ? 'payment.hu.simplepay'
        : 'payment.hu.barion';
      if (!evidenceRows.some((row) => row.protocol_id === expectedProtocolId)) continue;

      authenticatedPaymentSuccesses += 1;
      bump(authenticatedByProvider, auditProvider);

      stage = 'normalize_and_resolve';
      const evaluation = evaluatePaymentShadow({
        sourceEmailId: listed.providerMessageId,
        userId,
        provider: auditProvider,
        providerAuthenticated: true,
        subject: input.subject ?? '',
        body: input.bodyText ?? '',
        receivedAt: listed.receivedAt,
      }, purchases);

      if (!evaluation) {
        bump(rejectedByProvider, auditProvider);
        continue;
      }
      normalizedEvidence += 1;
      bump(normalizedByProvider, auditProvider);
      if (evaluation.wouldWrite || evaluation.resolution.wouldWrite) anyWouldWrite += 1;

      const diagnostic = paymentShadowPrivacyDiagnostic(evaluation);
      bump(contextCounts, diagnostic.context);
      bump(contextByProvider, `${diagnostic.provider}:${diagnostic.context}`);
      bump(decisionCounts, diagnostic.decision);
      bump(decisionByProvider, `${diagnostic.provider}:${diagnostic.decision}`);
      bump(scoreBandCounts, diagnostic.scoreBand);
      bump(strictSignalCounts, String(diagnostic.strictSignalCount));
      if (diagnostic.decision === 'shadow_linkable') shadowLinkable += 1;
      else if (diagnostic.decision === 'review') review += 1;
      else unmatched += 1;
      if (diagnostic.ambiguous) ambiguous += 1;
      if (diagnostic.strictSignalCount === 3) strictThreeSignalRows += 1;
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  stage = 'verify_safety';
  if (productionEligibleRows !== 0) throw new Error('production_eligible_payment_evidence');
  if (anyWouldWrite !== 0) throw new Error('write_authority_detected');

  stage = 'complete';
  console.log(JSON.stringify({
    mode: 'read_only_payment_shadow_link_audit_v1',
    safety: {
      databaseWrites: false,
      sourceEmailWrites: false,
      purchaseWrites: false,
      paymentWrites: false,
      purchaseStateUpdates: false,
      productionRegistryUsed: false,
      productionEligibleRows,
      anyWouldWrite,
      rawBodyOutput: false,
      rawSubjectOutput: false,
      messageIdOutput: false,
      senderOutput: false,
      merchantOutput: false,
      paymentReferenceOutput: false,
      merchantReferenceOutput: false,
      purchaseIdOutput: false,
      orderNumberOutput: false,
      amountOutput: false,
    },
    pagination: {
      pageSize: PAGE_SIZE,
      pages,
      maxMessagesSafetyCap: MAX_MESSAGES,
      truncated,
      rateLimitRetries,
    },
    scan: {
      totalMessages: seen.size,
      oldestReceivedAt,
      newestReceivedAt,
      providerSenderCandidates,
      fullMessageFetches,
      fullMessageFetchFailures,
      purchasesLoaded: purchases.length,
      strictIdentityReadyPurchases,
    },
    paymentEvidence: {
      authenticatedPaymentSuccesses,
      normalizedEvidence,
      normalizerRejected: authenticatedPaymentSuccesses - normalizedEvidence,
      byProvider: sortedObject(byProvider),
      authenticatedByProvider: sortedObject(authenticatedByProvider),
      normalizedByProvider: sortedObject(normalizedByProvider),
      normalizerRejectedByProvider: sortedObject(rejectedByProvider),
      contextCounts: sortedObject(contextCounts),
      contextByProvider: sortedObject(contextByProvider),
    },
    resolution: {
      shadowLinkable,
      review,
      unmatched,
      ambiguous,
      strictThreeSignalRows,
      decisionCounts: sortedObject(decisionCounts),
      decisionByProvider: sortedObject(decisionByProvider),
      scoreBandCounts: sortedObject(scoreBandCounts),
      strictSignalCounts: sortedObject(strictSignalCounts),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    mode: 'read_only_payment_shadow_link_audit_v1',
    status: 'failed',
    stage,
    errorKind: error instanceof Error ? error.name : 'UnknownError',
    statusCode: statusCodeOf(error),
    rawErrorOutput: false,
  }));
  process.exit(1);
});
