import { env, requireNylasSmokeGrantId } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';
import { detectProtocolEvidence } from '../protocols/detect.js';
import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type { ProtocolProfile } from '../protocols/types.js';
import {
  evaluatePaymentShadow,
  paymentShadowPrivacyDiagnostic,
} from '../resolution/payment-shadow-evaluation.js';
import type { PaymentShadowPurchaseIdentity } from '../resolution/payment-shadow-resolution.js';

const PAGE_SIZE = 100;
const MAX_MESSAGES = Math.min(
  Math.max(Number.parseInt(process.env.PAYMENT_SHADOW_AUDIT_MAX_MESSAGES ?? '10000', 10) || 10_000, 1),
  10_000,
);
const FULL_MESSAGE_CONCURRENCY = Math.min(
  Math.max(Number.parseInt(process.env.PAYMENT_SHADOW_AUDIT_CONCURRENCY ?? '6', 10) || 6, 1),
  12,
);

interface EmailConnectionRow {
  user_id: string;
  provider_account_id: string;
}

interface PurchaseRow {
  id: string;
  user_id: string;
  merchant_domain: string | null;
  merchant_name: string | null;
  order_number: string | null;
  total_amount: number | string | null;
  currency: string | null;
  ordered_at: string | null;
}

type AuditProvider = 'simplepay' | 'barion';

const PAYMENT_PROFILE_IDS = new Set([
  'payment.hu.simplepay',
  'payment.hu.barion',
]);

const SIMPLEPAY_ADDRESSES = new Set(['noreply@simplepay.hu']);
const BARION_ADDRESSES = new Set(['barion@barion.com', 'noreply@barion.com']);

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function providerForMessage(message: NormalizedEmail): AuditProvider | null {
  const addresses = message.from
    .map((sender) => sender.email.trim().toLowerCase())
    .filter(Boolean);

  if (addresses.some((address) => SIMPLEPAY_ADDRESSES.has(address))) return 'simplepay';
  if (addresses.some((address) => BARION_ADDRESSES.has(address))) return 'barion';
  return null;
}

function finiteNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPurchaseIdentity(row: PurchaseRow): PaymentShadowPurchaseIdentity {
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

async function main() {
  const grantId = requireNylasSmokeGrantId();
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: grantId,
  });
  const supabase = getSupabaseAdmin() as any;

  const paymentProfiles = registeredTestProtocolProfiles().filter(
    (profile): profile is ProtocolProfile => PAYMENT_PROFILE_IDS.has(profile.protocol_id),
  );
  if (paymentProfiles.length !== 2) {
    throw new Error(`Expected exactly 2 payment audit profiles, got ${paymentProfiles.length}.`);
  }

  const { data: connectionRows, error: connectionError } = await supabase
    .from('email_connections')
    .select('user_id,provider_account_id')
    .eq('provider_account_id', grantId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .limit(2);
  if (connectionError) {
    throw new Error(`Failed to load audit email connection: ${connectionError.message}`);
  }

  const connections = (connectionRows ?? []) as EmailConnectionRow[];
  if (connections.length !== 1) {
    throw new Error(`Expected exactly one active audit email connection, got ${connections.length}.`);
  }
  const userId = connections[0]!.user_id;

  const { data: purchaseRows, error: purchaseError } = await supabase
    .from('purchases')
    .select('id,user_id,merchant_domain,merchant_name,order_number,total_amount,currency,ordered_at')
    .eq('user_id', userId)
    .order('ordered_at', { ascending: true, nullsFirst: true });
  if (purchaseError) {
    throw new Error(`Failed to load purchases for audit: ${purchaseError.message}`);
  }

  const purchases = ((purchaseRows ?? []) as PurchaseRow[]).map(toPurchaseIdentity);
  const strictIdentityReadyPurchases = purchases.filter((purchase) =>
    Boolean(
      purchase.merchantDomain &&
      purchase.totalAmount !== null &&
      purchase.currency &&
      purchase.orderedAt,
    ),
  ).length;

  const seenMessageIds = new Set<string>();
  const byProvider = new Map<string, number>();
  const authenticatedByProvider = new Map<string, number>();
  const normalizedByProvider = new Map<string, number>();
  const normalizerRejectedByProvider = new Map<string, number>();
  const contextCounts = new Map<string, number>();
  const decisionCounts = new Map<string, number>();
  const scoreBandCounts = new Map<string, number>();
  const strictSignalCounts = new Map<string, number>();
  const decisionByProvider = new Map<string, number>();
  const contextByProvider = new Map<string, number>();

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let providerSenderCandidates = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let authenticatedPaymentSuccesses = 0;
  let productionEligibleRows = 0;
  let normalizedEvidence = 0;
  let shadowLinkable = 0;
  let review = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let strictThreeSignalRows = 0;
  let anyWouldWrite = 0;
  let oldestReceivedAt: string | null = null;
  let newestReceivedAt: string | null = null;

  do {
    const page = await provider.searchMessages({
      query: env.EMAIL_DISCOVERY_QUERY,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    pages += 1;

    const pageCandidates: Array<{ metadata: NormalizedEmail; auditProvider: AuditProvider }> = [];

    for (const message of page.messages) {
      if (seenMessageIds.has(message.providerMessageId)) continue;
      if (seenMessageIds.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }

      seenMessageIds.add(message.providerMessageId);
      if (!oldestReceivedAt || message.receivedAt < oldestReceivedAt) oldestReceivedAt = message.receivedAt;
      if (!newestReceivedAt || message.receivedAt > newestReceivedAt) newestReceivedAt = message.receivedAt;

      const auditProvider = providerForMessage(message);
      if (!auditProvider) continue;

      providerSenderCandidates += 1;
      bump(byProvider, auditProvider);
      pageCandidates.push({ metadata: message, auditProvider });
    }

    const evaluations = await mapWithConcurrency(
      pageCandidates,
      FULL_MESSAGE_CONCURRENCY,
      async ({ metadata, auditProvider }) => {
        fullMessageFetches += 1;
        try {
          const fullMessage = await provider.getMessage(metadata.providerMessageId);
          const input = protocolDetectionInputFromEmail(fullMessage);
          const evidenceRows = detectProtocolEvidence(input, paymentProfiles).filter(
            (row) => row.event_candidate === 'PAYMENT_SUCCESS',
          );
          return { metadata, auditProvider, input, evidenceRows };
        } catch {
          fullMessageFetchFailures += 1;
          return null;
        }
      },
    );

    for (const row of evaluations) {
      if (!row) continue;
      const { metadata, auditProvider, input, evidenceRows } = row;

      productionEligibleRows += evidenceRows.filter((evidence) => evidence.production_eligible).length;
      const expectedProtocolId = auditProvider === 'simplepay'
        ? 'payment.hu.simplepay'
        : 'payment.hu.barion';
      const authenticated = evidenceRows.some((evidence) => evidence.protocol_id === expectedProtocolId);
      if (!authenticated) continue;

      authenticatedPaymentSuccesses += 1;
      bump(authenticatedByProvider, auditProvider);

      const evaluation = evaluatePaymentShadow(
        {
          sourceEmailId: metadata.providerMessageId,
          userId,
          provider: auditProvider,
          providerAuthenticated: true,
          subject: input.subject ?? '',
          body: input.bodyText ?? '',
          receivedAt: metadata.receivedAt,
        },
        purchases,
      );

      if (!evaluation) {
        bump(normalizerRejectedByProvider, auditProvider);
        continue;
      }

      normalizedEvidence += 1;
      bump(normalizedByProvider, auditProvider);
      if (evaluation.wouldWrite || evaluation.resolution.wouldWrite) anyWouldWrite += 1;

      const diagnostic = paymentShadowPrivacyDiagnostic(evaluation);
      bump(contextCounts, diagnostic.context);
      bump(decisionCounts, diagnostic.decision);
      bump(scoreBandCounts, diagnostic.scoreBand);
      bump(strictSignalCounts, String(diagnostic.strictSignalCount));
      bump(decisionByProvider, `${diagnostic.provider}:${diagnostic.decision}`);
      bump(contextByProvider, `${diagnostic.provider}:${diagnostic.context}`);

      if (diagnostic.decision === 'shadow_linkable') shadowLinkable += 1;
      else if (diagnostic.decision === 'review') review += 1;
      else unmatched += 1;
      if (diagnostic.ambiguous) ambiguous += 1;
      if (diagnostic.strictSignalCount === 3) strictThreeSignalRows += 1;
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  if (productionEligibleRows > 0) {
    throw new Error(`Audit safety invariant violated: ${productionEligibleRows} payment rows were production eligible.`);
  }
  if (anyWouldWrite > 0) {
    throw new Error(`Audit safety invariant violated: ${anyWouldWrite} evaluations had write authority.`);
  }

  const result = {
    mode: 'read_only_payment_shadow_link_audit_v1',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
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
      fullMessageConcurrency: FULL_MESSAGE_CONCURRENCY,
    },
    scan: {
      totalMessages: seenMessageIds.size,
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
      normalizerRejectedByProvider: sortedObject(normalizerRejectedByProvider),
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
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(
    'Nylas payment shadow link audit failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exit(1);
});
