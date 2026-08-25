import { createHash } from 'node:crypto';
import { NylasEmailProvider } from '../email/nylas-provider.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

type BucketName = 'purchases' | 'updates' | 'promotions';

type SelectedCase = {
  bucket: BucketName;
  email: NormalizedEmail;
};

const QUERY_SPECS: Array<{ bucket: BucketName; query: string; take: number }> = [
  {
    bucket: 'purchases',
    query: 'after:2026/05/01 before:2026/07/01 category:purchases -in:spam -in:trash',
    take: 60,
  },
  {
    bucket: 'updates',
    query: 'after:2026/05/01 before:2026/07/01 category:updates -in:spam -in:trash',
    take: 20,
  },
  {
    bucket: 'promotions',
    query: 'after:2026/05/01 before:2026/07/01 category:promotions -in:spam -in:trash',
    take: 26,
  },
];

function requireSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function firstN(provider: NylasEmailProvider, query: string, take: number): Promise<NormalizedEmail[]> {
  const selected: NormalizedEmail[] = [];
  let cursor: string | undefined;
  while (selected.length < take) {
    const page = await provider.searchMessages({
      query,
      limit: Math.min(200, take - selected.length),
      ...(cursor ? { cursor } : {}),
    });
    selected.push(...page.messages.slice(0, take - selected.length));
    if (selected.length >= take) break;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  if (selected.length !== take) {
    throw new Error(`phase_e_100_freeze_query_count_mismatch:${take}:${selected.length}`);
  }
  return selected;
}

function opaqueCaseId(providerMessageId: string): string {
  return createHash('sha256')
    .update(`phase-e-100-real-gmail-v1\u0000${providerMessageId}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

function senderDomain(email: NormalizedEmail): string | null {
  const address = email.from[0]?.email?.trim().toLowerCase();
  if (!address || !address.includes('@')) return null;
  return address.slice(address.lastIndexOf('@') + 1) || null;
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

async function main() {
  const provider = new NylasEmailProvider({
    apiKey: requireSecret('NYLAS_API_KEY'),
    apiUri: process.env.NYLAS_API_URI?.trim() || 'https://api.eu.nylas.com',
    grantId: requireSecret('NYLAS_GRANT_ID'),
  });

  const seen = new Set<string>();
  const selected: SelectedCase[] = [];
  const rawCounts: Record<BucketName, number> = { purchases: 0, updates: 0, promotions: 0 };
  const uniqueCounts: Record<BucketName, number> = { purchases: 0, updates: 0, promotions: 0 };

  for (const spec of QUERY_SPECS) {
    const raw = await firstN(provider, spec.query, spec.take);
    rawCounts[spec.bucket] = raw.length;
    for (const message of raw) {
      if (seen.has(message.providerMessageId)) continue;
      seen.add(message.providerMessageId);
      selected.push({ bucket: spec.bucket, email: message });
      uniqueCounts[spec.bucket] += 1;
    }
  }

  if (selected.length !== 100 || uniqueCounts.purchases !== 60 || uniqueCounts.updates !== 14 || uniqueCounts.promotions !== 26) {
    throw new Error(`phase_e_100_frozen_selection_mismatch:${JSON.stringify({ rawCounts, uniqueCounts, uniqueTotal: selected.length })}`);
  }

  // Fetch each message with headers so direct-provider authentication evidence is available.
  const hydrated: SelectedCase[] = [];
  for (const item of selected) {
    hydrated.push({ bucket: item.bucket, email: await provider.getMessage(item.email.providerMessageId) });
  }

  // Replay oldest -> newest. Only promotion-eligible simulated mutations are carried forward,
  // approximating the future controlled-write path while keeping this runner entirely in memory.
  hydrated.sort((a, b) => a.email.receivedAt.localeCompare(b.email.receivedAt));

  let snapshot = emptySnapshot();
  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  const rows: Array<Record<string, unknown>> = [];
  let eligibleCreates = 0;
  let eligibleLinks = 0;
  let blocked = 0;
  let noCanonicalEvent = 0;
  let reviewOrPending = 0;
  let promotionBucketViolations = 0;

  for (const item of hydrated) {
    const shadow = runPurchaseIdentityShadow({
      userId: 'phase-e-100-private-audit-user',
      document: buildEmailDocumentV1(item.email),
      snapshot,
      merchantResolver,
    });

    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0 || shadow.promotionReadiness.productionWrites !== 0) {
      throw new Error('phase_e_100_requires_zero_write_zero_ai');
    }

    const event = shadow.canonicalEvent;
    const decisionKind = shadow.decision?.kind ?? null;
    const eligible = shadow.promotionReadiness.eligible;
    const action = shadow.promotionReadiness.action;

    if (!event) noCanonicalEvent += 1;
    if (decisionKind === 'REVIEW' || decisionKind === 'PENDING') reviewOrPending += 1;
    if (!eligible) blocked += 1;
    if (eligible && action === 'CREATE_PURCHASE') eligibleCreates += 1;
    if (eligible && action === 'LINK_EVENT') eligibleLinks += 1;
    if (eligible && item.bucket === 'promotions') promotionBucketViolations += 1;

    // Carry forward only decisions that Phase E itself says could be promoted.
    if (eligible && shadow.simulatedGraphMutated) snapshot = shadow.simulatedSnapshot;

    if (eligible || event || decisionKind === 'REVIEW' || decisionKind === 'PENDING') {
      rows.push({
        caseId: opaqueCaseId(item.email.providerMessageId),
        bucket: item.bucket,
        receivedDay: item.email.receivedAt.slice(0, 10),
        senderDomain: senderDomain(item.email),
        eventType: event?.eventType ?? null,
        sourceRole: event?.sourceRole ?? null,
        decisionKind,
        promotionEligible: eligible,
        promotionAction: action,
        promotionReasons: shadow.promotionReadiness.reasons,
        hasOrderIdentity: Boolean(event?.orderIdNormalized ?? event?.orderIdRaw),
        hasTrackingIdentity: Boolean(event?.trackingIdNormalized ?? event?.trackingIdRaw),
        hasInvoiceIdentity: Boolean(event?.invoiceIdNormalized ?? event?.invoiceIdRaw),
        hasPaymentReference: Boolean(event?.paymentReference),
        hardReasonTypes: shadow.decision?.reasons
          .filter((reason) => reason.strength === 'hard')
          .map((reason) => reason.evidenceType) ?? [],
      });
    }
  }

  const report = {
    version: 'phase-e-100-real-gmail-blind-v1',
    mode: 'private-read-only-shadow',
    productionWrites: 0,
    aiCalls: 0,
    rawCounts,
    uniqueCounts,
    cases: hydrated.length,
    eligibleCreates,
    eligibleLinks,
    blocked,
    noCanonicalEvent,
    reviewOrPending,
    promotionBucketViolations,
    finalSimulatedCounts: {
      purchases: snapshot.purchases.length,
      orders: snapshot.orders.length,
      shipments: snapshot.shipments.length,
      payments: snapshot.payments.length,
      invoices: snapshot.invoices.length,
    },
    rows,
  };

  console.log(`PHASE_E_100_REAL_GMAIL_BLIND_SCORE ${JSON.stringify(report)}`);

  if (promotionBucketViolations !== 0) {
    throw new Error(`phase_e_100_promotional_noise_unsafe:${promotionBucketViolations}`);
  }
}

main().catch((error) => {
  console.error('Phase E 100 real Gmail blind audit failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
