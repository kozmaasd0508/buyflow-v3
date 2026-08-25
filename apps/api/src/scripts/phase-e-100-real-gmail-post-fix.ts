import { createHash } from 'node:crypto';
import { NylasEmailProvider } from '../email/nylas-provider.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

type Bucket = 'purchases' | 'updates' | 'promotions';
type Case = { bucket: Bucket; email: NormalizedEmail };

const SPECS: Array<{ bucket: Bucket; query: string; take: number }> = [
  { bucket: 'purchases', query: 'after:2026/05/01 before:2026/07/01 category:purchases -in:spam -in:trash', take: 60 },
  { bucket: 'updates', query: 'after:2026/05/01 before:2026/07/01 category:updates -in:spam -in:trash', take: 20 },
  { bucket: 'promotions', query: 'after:2026/05/01 before:2026/07/01 category:promotions -in:spam -in:trash', take: 26 },
];

function secret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

async function firstN(provider: NylasEmailProvider, query: string, take: number): Promise<NormalizedEmail[]> {
  const out: NormalizedEmail[] = [];
  let cursor: string | undefined;
  while (out.length < take) {
    const page = await provider.searchMessages({ query, limit: Math.min(200, take - out.length), ...(cursor ? { cursor } : {}) });
    out.push(...page.messages.slice(0, take - out.length));
    if (out.length >= take || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  if (out.length !== take) throw new Error(`freeze_count_mismatch:${take}:${out.length}`);
  return out;
}

function opaque(id: string): string {
  return createHash('sha256').update(`phase-e-100-post-fix\u0000${id}`).digest('hex').slice(0, 16);
}

function domain(email: NormalizedEmail): string | null {
  const address = email.from[0]?.email?.toLowerCase() ?? '';
  return address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : null;
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

async function main() {
  const provider = new NylasEmailProvider({
    apiKey: secret('NYLAS_API_KEY'),
    grantId: secret('NYLAS_GRANT_ID'),
    apiUri: process.env.NYLAS_API_URI?.trim() || 'https://api.eu.nylas.com',
  });

  const seen = new Set<string>();
  const selected: Case[] = [];
  const uniqueCounts: Record<Bucket, number> = { purchases: 0, updates: 0, promotions: 0 };

  for (const spec of SPECS) {
    for (const email of await firstN(provider, spec.query, spec.take)) {
      if (seen.has(email.providerMessageId)) continue;
      seen.add(email.providerMessageId);
      selected.push({ bucket: spec.bucket, email });
      uniqueCounts[spec.bucket] += 1;
    }
  }
  if (selected.length !== 100 || uniqueCounts.purchases !== 60 || uniqueCounts.updates !== 14 || uniqueCounts.promotions !== 26) {
    throw new Error(`frozen_selection_mismatch:${JSON.stringify({ uniqueCounts, total: selected.length })}`);
  }

  const hydrated: Case[] = [];
  for (const item of selected) hydrated.push({ bucket: item.bucket, email: await provider.getMessage(item.email.providerMessageId) });
  hydrated.sort((a, b) => a.email.receivedAt.localeCompare(b.email.receivedAt));

  let snapshot = emptySnapshot();
  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  const rows: Array<Record<string, unknown>> = [];
  let eligibleCreates = 0;
  let eligibleLinks = 0;
  let blocked = 0;
  let promotionBucketViolations = 0;

  for (const item of hydrated) {
    const document = buildEmailDocumentV1(item.email);
    const shadow = runPurchaseIdentityShadow({
      userId: 'phase-e-100-private-post-fix-user',
      document,
      snapshot,
      merchantResolver,
    });
    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0 || shadow.promotionReadiness.productionWrites !== 0) {
      throw new Error('zero_write_zero_ai_invariant_failed');
    }

    const eligible = shadow.promotionReadiness.eligible;
    const action = shadow.promotionReadiness.action;
    if (eligible && action === 'CREATE_PURCHASE') eligibleCreates += 1;
    if (eligible && action === 'LINK_EVENT') eligibleLinks += 1;
    if (!eligible) blocked += 1;
    if (eligible && item.bucket === 'promotions') promotionBucketViolations += 1;
    if (eligible && shadow.simulatedGraphMutated) snapshot = shadow.simulatedSnapshot;

    if (eligible || shadow.canonicalEvent || shadow.decision?.kind === 'REVIEW' || shadow.decision?.kind === 'PENDING') {
      rows.push({
        caseId: opaque(item.email.providerMessageId),
        bucket: item.bucket,
        day: item.email.receivedAt.slice(0, 10),
        senderDomain: domain(item.email),
        eventType: shadow.canonicalEvent?.eventType ?? null,
        decision: shadow.decision?.kind ?? null,
        creationAuthority: shadow.canonicalEvent?.purchaseCreationAuthority ?? null,
        creationReasons: shadow.canonicalEvent?.purchaseCreationReasons ?? [],
        orderSummarySections: document.sections.filter((section) => section.type === 'order_summary').length,
        products: document.signals.products.length,
        amounts: document.signals.amounts.length,
        promotionEligible: eligible,
        promotionAction: action,
        promotionReasons: shadow.promotionReadiness.reasons,
        hasOrderIdentity: Boolean(shadow.canonicalEvent?.orderIdNormalized ?? shadow.canonicalEvent?.orderIdRaw),
        hasTrackingIdentity: Boolean(shadow.canonicalEvent?.trackingIdNormalized ?? shadow.canonicalEvent?.trackingIdRaw),
      });
    }
  }

  const report = {
    cases: hydrated.length,
    uniqueCounts,
    eligibleCreates,
    eligibleLinks,
    blocked,
    promotionBucketViolations,
    productionWrites: 0,
    aiCalls: 0,
    finalSimulatedCounts: {
      purchases: snapshot.purchases.length,
      orders: snapshot.orders.length,
      shipments: snapshot.shipments.length,
      payments: snapshot.payments.length,
      invoices: snapshot.invoices.length,
    },
    rows,
  };

  console.log(`PHASE_E_100_REAL_GMAIL_POST_FIX ${JSON.stringify(report)}`);
  if (promotionBucketViolations !== 0) throw new Error(`promotional_noise_unsafe:${promotionBucketViolations}`);
}

main().catch((error) => {
  console.error('Phase E 100 post-fix audit failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
