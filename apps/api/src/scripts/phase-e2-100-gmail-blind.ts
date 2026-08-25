import { createHash } from 'node:crypto';
import { requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

const USER_ID = 'phase-e2-live-audit-user';
const PURCHASE_QUERY = 'after:2026/06/01 before:2026/07/01 category:purchases -in:spam -in:trash';
const CONTROL_QUERY = 'after:2026/06/01 before:2026/07/01 -category:purchases -in:spam -in:trash';
const PURCHASE_COUNT = 70;
const CONTROL_COUNT = 30;
const FETCH_CONCURRENCY = 4;

type SelectedMessage = {
  caseId: string;
  group: 'purchase' | 'control';
  ordinal: number;
  metadata: NormalizedEmail;
  full?: NormalizedEmail;
};

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function domainOf(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at >= 0 ? value.slice(at + 1) : '';
}

function selectedCaseId(group: SelectedMessage['group'], ordinal: number): string {
  return `${group === 'purchase' ? 'P' : 'C'}${String(ordinal).padStart(2, '0')}`;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function runWorker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  ));
  return results;
}

function selectionFingerprint(messages: readonly SelectedMessage[]): string {
  const hash = createHash('sha256');
  for (const item of messages) {
    const senderDomain = domainOf(item.metadata.from[0]?.email ?? '');
    const subjectHash = createHash('sha256')
      .update(item.metadata.subject ?? '')
      .digest('hex')
      .slice(0, 16);
    hash.update(`${item.caseId}|${item.metadata.receivedAt}|${senderDomain}|${subjectHash}\n`);
  }
  return hash.digest('hex');
}

async function selectFirst(
  provider: ReturnType<typeof createEmailProvider>,
  query: string,
  count: number,
  group: SelectedMessage['group'],
): Promise<SelectedMessage[]> {
  const page = await provider.searchMessages({ query, limit: count });
  if (page.messages.length !== count) {
    throw new Error(`Phase E2 selection expected ${count} ${group} messages, got ${page.messages.length}.`);
  }
  return page.messages.map((metadata, index) => ({
    caseId: selectedCaseId(group, index + 1),
    group,
    ordinal: index + 1,
    metadata,
  }));
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const purchases = await selectFirst(provider, PURCHASE_QUERY, PURCHASE_COUNT, 'purchase');
  const controls = await selectFirst(provider, CONTROL_QUERY, CONTROL_COUNT, 'control');
  const selected = [...purchases, ...controls];

  if (selected.length !== 100) throw new Error(`Phase E2 selection must contain exactly 100 messages.`);
  const providerIds = selected.map((item) => item.metadata.providerMessageId);
  if (new Set(providerIds).size !== providerIds.length) {
    throw new Error('Phase E2 selection contains duplicate provider message ids.');
  }

  const withFull = await mapWithConcurrency(selected, FETCH_CONCURRENCY, async (item) => ({
    ...item,
    full: await provider.getMessage(item.metadata.providerMessageId),
  }));

  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let snapshot = emptySnapshot();
  let eligible = 0;
  let eligibleCreates = 0;
  let eligibleLinks = 0;
  let reviewOrPending = 0;
  let unlinked = 0;
  let noCanonicalEvent = 0;
  let fullMessageFailures = 0;
  let bodyMissing = 0;
  let headersMissing = 0;

  const observations: Array<Record<string, unknown>> = [];
  const chronological = [...withFull].sort((a, b) =>
    a.full!.receivedAt.localeCompare(b.full!.receivedAt) || a.caseId.localeCompare(b.caseId),
  );

  for (const item of chronological) {
    const email = item.full;
    if (!email) {
      fullMessageFailures += 1;
      observations.push({ caseId: item.caseId, status: 'fetch_error' });
      continue;
    }
    if (!email.bodyHtml && !email.snippet) bodyMissing += 1;
    if ((email.headers?.length ?? 0) === 0) headersMissing += 1;

    const shadow = runPurchaseIdentityShadow({
      userId: USER_ID,
      document: buildEmailDocumentV1(email),
      snapshot,
      merchantResolver,
    });

    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0) {
      throw new Error(`${item.caseId}: shadow invariant violated.`);
    }
    if (shadow.promotionReadiness.productionWrites !== 0 || shadow.promotionReadiness.mode !== 'audit_only') {
      throw new Error(`${item.caseId}: promotion invariant violated.`);
    }

    const event = shadow.canonicalEvent;
    const decision = shadow.decision;
    const promotion = shadow.promotionReadiness;

    if (!event) noCanonicalEvent += 1;
    if (decision?.kind === 'REVIEW' || decision?.kind === 'PENDING') reviewOrPending += 1;
    if (decision?.kind === 'UNLINKED') unlinked += 1;

    if (promotion.eligible) {
      eligible += 1;
      if (promotion.action === 'CREATE_PURCHASE') eligibleCreates += 1;
      if (promotion.action === 'LINK_EVENT') eligibleLinks += 1;
      snapshot = shadow.simulatedSnapshot;
    }

    observations.push({
      caseId: item.caseId,
      group: item.group,
      eventType: event?.eventType ?? null,
      sourceRole: event?.sourceRole ?? null,
      decision: decision?.kind ?? null,
      promotionEligible: promotion.eligible,
      promotionAction: promotion.action,
      promotionReasons: promotion.reasons,
      hardEvidenceTypes: decision?.reasons
        .filter((edge) => edge.strength === 'hard')
        .map((edge) => edge.evidenceType) ?? [],
      identityPresence: event ? {
        merchant: Boolean(event.merchantId || event.merchantNamespace),
        order: Boolean(event.orderIdNormalized || event.orderIdRaw),
        tracking: Boolean(event.trackingIdNormalized || event.trackingIdRaw),
        payment: Boolean(event.paymentReference),
        invoice: Boolean(event.invoiceIdNormalized || event.invoiceIdRaw),
      } : null,
    });
  }

  const result = {
    mode: 'phase_e2_100_message_live_blind_shadow',
    safety: {
      productionWrites: 0,
      aiCalls: 0,
      rawBodyOutput: false,
      subjectOutput: false,
      senderAddressOutput: false,
      providerMessageIdOutput: false,
      transactionIdentifierOutput: false,
    },
    selection: {
      purchases: purchases.length,
      controls: controls.length,
      total: selected.length,
      fingerprint: selectionFingerprint(selected),
      purchaseQuery: PURCHASE_QUERY,
      controlQuery: CONTROL_QUERY,
    },
    fidelity: {
      fullMessageFailures,
      bodyMissing,
      headersMissing,
    },
    scoreInput: {
      eligible,
      eligibleCreates,
      eligibleLinks,
      reviewOrPending,
      unlinked,
      noCanonicalEvent,
      finalPromotedSnapshotCounts: {
        purchases: snapshot.purchases.length,
        orders: snapshot.orders.length,
        shipments: snapshot.shipments.length,
        payments: snapshot.payments.length,
        invoices: snapshot.invoices.length,
      },
    },
    observations,
  };

  console.log('PHASE_E2_100_GMAIL_LIVE_BLIND_SHADOW', JSON.stringify(result));
}

main().catch((error) => {
  console.error('Phase E2 100-message live blind shadow failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
