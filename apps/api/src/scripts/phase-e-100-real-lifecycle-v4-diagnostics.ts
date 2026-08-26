import { createHash } from 'node:crypto';
import { NylasEmailProvider } from '../email/nylas-provider.js';
import type { NormalizedEmail } from '../email/types.js';
import { isCarrierSenderDomain, isPublicMailboxSenderDomain } from '../email/sender-role.js';
import { buildEmailDocumentV1, type EmailDocumentV1 } from '../ingestion/email-document.js';
import { isSharedPlatformSenderDomain } from '../ingestion/generic-order-confirmation-adapter.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

const SEARCH_WINDOW = 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash';
const ROOT_SOURCES = [
  { id: 'purchases', query: `${SEARCH_WINDOW} -category:promotions category:purchases`, cap: 1200 },
  { id: 'subject_rendeles', query: `${SEARCH_WINDOW} -category:promotions subject:rendelés`, cap: 600 },
  { id: 'subject_megrendeles', query: `${SEARCH_WINDOW} -category:promotions subject:megrendelés`, cap: 600 },
  { id: 'subject_order', query: `${SEARCH_WINDOW} -category:promotions subject:"order"`, cap: 600 },
] as const;
const ROOT_COUNT = 100;
const MAX_ORDER_TOKENS = 4;
const MAX_TRACKING_TOKENS = 4;

type AuditId = { raw: string; normalized: string };
type OriginKind = 'root' | 'order' | 'tracking';
type RootChain = {
  chainId: string;
  root: NormalizedEmail;
  rootOrder: AuditId;
  memberIds: Set<string>;
  memberOrigins: Map<string, Set<OriginKind>>;
  orderIds: Map<string, string>;
  trackingIds: Map<string, string>;
};

function secret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('secret_missing');
  return value;
}
function ascii(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').replace(/\r/g, '').toUpperCase();
}
function normalizeId(value: string): string { return value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function validAuditId(raw: string): AuditId | null {
  const cleaned = raw.trim().replace(/^[#'"(]+|[)'",;:.]+$/g, '');
  const normalized = normalizeId(cleaned);
  if (normalized.length < 4 || normalized.length > 36 || !/\d/.test(normalized)) return null;
  if (/^(?:19|20)\d{6}$/.test(normalized)) return null;
  return { raw: cleaned, normalized };
}
function addAuditId(out: Map<string, string>, raw: string | undefined): void {
  if (!raw) return;
  const parsed = validAuditId(raw);
  if (parsed && !out.has(parsed.normalized)) out.set(parsed.normalized, parsed.raw);
}
function auditOrderIds(email: NormalizedEmail, document = buildEmailDocumentV1(email)): AuditId[] {
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  const out = new Map<string, string>();
  const patterns = [
    /\b(?:RENDELES(?:I)?\s*(?:SZAM|AZONOSITO)|MEGRENDELES(?:I)?\s*(?:SZAM|AZONOSITO)|VASARLAS(?:I)?\s*AZONOSITO)\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b(?:RENDELES|MEGRENDELES)\s*#\s*([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b([A-Z0-9][A-Z0-9./-]{3,35})\s+(?:SZAMU\s+)?(?:MEG)?RENDELES(?:ET|EDET|ED|E|I|EN|ROL)?\b/g,
    /\b(?:ORDER\s*(?:NUMBER|NO|ID)?|ORDER\s*#)\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) addAuditId(out, match[1]);
  for (const value of document.signals.orderNumbers) addAuditId(out, value);
  return [...out.entries()].map(([normalized, raw]) => ({ raw, normalized }));
}
function auditTrackingIds(email: NormalizedEmail, document = buildEmailDocumentV1(email)): AuditId[] {
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  const out = new Map<string, string>();
  const pattern = /\b(?:TRACKING(?:\s*(?:NUMBER|NO|ID))?|NYOMKOVETESI\s*(?:SZAM|AZONOSITO)|CSOMAG(?:SZAM|AZONOSITOSZAM|AZONOSITO)|KULDEMENY(?:SZAM|AZONOSITO))\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,31})\b/g;
  for (const match of text.matchAll(pattern)) addAuditId(out, match[1]);
  for (const value of document.signals.trackingNumbers) addAuditId(out, value);
  return [...out.entries()].map(([normalized, raw]) => ({ raw, normalized }));
}
function senderDomain(email: NormalizedEmail): string | null {
  const address = email.from[0]?.email?.trim().toLowerCase() ?? '';
  return address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : null;
}
function opaque(prefix: string, value: string): string {
  return createHash('sha256').update(`${prefix}\u0000${value}`).digest('hex').slice(0, 16);
}
function qualifiesRoot(email: NormalizedEmail, document: EmailDocumentV1, orderIds: AuditId[]): boolean {
  const subject = ascii(email.subject ?? '').trim();
  if (/^(?:RE|FW|FWD):/.test(subject) || orderIds.length === 0) return false;
  const domain = senderDomain(email);
  if (!domain || isCarrierSenderDomain(domain) || isPublicMailboxSenderDomain(domain) || isSharedPlatformSenderDomain(domain)) return false;
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  return !/AUTOMATIKUSAN\s+MEGUJULO\s+ELOFIZETES|ELOFIZETESED|DIGITALIS\s+(?:LICENC|TARTALOM)|SOFTWARE\s+LICENSE|DOWNLOAD\s+ONLY|SUBSCRIPTION\s+RENEWAL|MEMBERSHIP\s+RENEWAL/.test(text);
}
function explicitRelation(email: NormalizedEmail, document: EmailDocumentV1): boolean {
  return /SPLIT\s+(?:ORDER|FROM)|PARENT\s+ORDER|SZULO\s+RENDELES|EREDETI\s+RENDELES|HELYETTESITO\s+RENDELES|REPLACEMENT\s+(?:FOR|ORDER)|RESZRENDELES/.test(ascii(`${email.subject ?? ''}\n${document.text}`));
}
function emptySnapshot(): PurchaseIdentitySnapshot { return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] }; }
function addMember(chain: RootChain, messageId: string, origin: OriginKind): void {
  chain.memberIds.add(messageId);
  const origins = chain.memberOrigins.get(messageId) ?? new Set<OriginKind>();
  origins.add(origin);
  chain.memberOrigins.set(messageId, origins);
}
async function upToN(provider: NylasEmailProvider, query: string, cap: number): Promise<NormalizedEmail[]> {
  const out: NormalizedEmail[] = [];
  let cursor: string | undefined;
  while (out.length < cap) {
    const page = await provider.searchMessages({ query, limit: Math.min(200, cap - out.length), ...(cursor ? { cursor } : {}) });
    out.push(...page.messages.slice(0, cap - out.length));
    if (!page.nextCursor || page.messages.length === 0) break;
    cursor = page.nextCursor;
  }
  return out;
}
async function searchExact(provider: NylasEmailProvider, token: string, take = 50): Promise<NormalizedEmail[]> {
  const safe = token.replace(/["\r\n]/g, '').trim();
  if (!safe) return [];
  const page = await provider.searchMessages({ query: `"${safe}" ${SEARCH_WINDOW}`, limit: take });
  return page.messages.slice(0, take);
}

async function main(): Promise<void> {
  const provider = new NylasEmailProvider({ apiKey: secret('NYLAS_API_KEY'), grantId: secret('NYLAS_GRANT_ID'), apiUri: process.env.NYLAS_API_URI?.trim() || 'https://api.eu.nylas.com' });
  const cache = new Map<string, NormalizedEmail>();
  const hydrate = async (ref: NormalizedEmail): Promise<NormalizedEmail> => {
    const cached = cache.get(ref.providerMessageId);
    if (cached) return cached;
    const full = await provider.getMessage(ref.providerMessageId);
    cache.set(full.providerMessageId, full);
    return full;
  };

  const roots: RootChain[] = [];
  const rootKeys = new Set<string>();
  const seenCandidateIds = new Set<string>();
  for (const source of ROOT_SOURCES) {
    if (roots.length >= ROOT_COUNT) break;
    for (const ref of await upToN(provider, source.query, source.cap)) {
      if (roots.length >= ROOT_COUNT) break;
      if (seenCandidateIds.has(ref.providerMessageId)) continue;
      seenCandidateIds.add(ref.providerMessageId);
      const email = await hydrate(ref);
      const document = buildEmailDocumentV1(email);
      const ids = auditOrderIds(email, document);
      if (!qualifiesRoot(email, document, ids)) continue;
      const rootOrder = ids[0];
      const domain = senderDomain(email);
      if (!rootOrder || !domain) continue;
      const key = `${domain}\u0000${rootOrder.normalized}`;
      if (rootKeys.has(key)) continue;
      rootKeys.add(key);
      const chainId = opaque('phase-e-100-v4-chain', key);
      roots.push({
        chainId,
        root: email,
        rootOrder,
        memberIds: new Set([email.providerMessageId]),
        memberOrigins: new Map([[email.providerMessageId, new Set<OriginKind>(['root'])]]),
        orderIds: new Map([[rootOrder.normalized, rootOrder.raw]]),
        trackingIds: new Map(),
      });
    }
  }
  if (roots.length !== ROOT_COUNT) throw new Error(`diagnostic_root_count_mismatch:${roots.length}`);

  for (const chain of roots) {
    const pendingOrders = [chain.rootOrder.raw];
    const seenOrders = new Set<string>();
    const pendingTracking: string[] = [];
    const seenTracking = new Set<string>();
    while (pendingOrders.length > 0 && seenOrders.size < MAX_ORDER_TOKENS) {
      const token = pendingOrders.shift();
      if (!token) continue;
      const norm = normalizeId(token);
      if (!norm || seenOrders.has(norm)) continue;
      seenOrders.add(norm);
      for (const ref of await searchExact(provider, token)) {
        const email = await hydrate(ref);
        addMember(chain, email.providerMessageId, 'order');
        const document = buildEmailDocumentV1(email);
        for (const tracking of auditTrackingIds(email, document)) {
          if (!chain.trackingIds.has(tracking.normalized)) {
            chain.trackingIds.set(tracking.normalized, tracking.raw);
            pendingTracking.push(tracking.raw);
          }
        }
        if (explicitRelation(email, document)) {
          for (const related of auditOrderIds(email, document)) {
            if (!chain.orderIds.has(related.normalized)) {
              chain.orderIds.set(related.normalized, related.raw);
              pendingOrders.push(related.raw);
            }
          }
        }
      }
    }
    while (pendingTracking.length > 0 && seenTracking.size < MAX_TRACKING_TOKENS) {
      const token = pendingTracking.shift();
      if (!token) continue;
      const norm = normalizeId(token);
      if (!norm || seenTracking.has(norm)) continue;
      seenTracking.add(norm);
      for (const ref of await searchExact(provider, token)) {
        const email = await hydrate(ref);
        addMember(chain, email.providerMessageId, 'tracking');
      }
    }
  }

  const chainById = new Map(roots.map((chain) => [chain.chainId, chain]));
  const messageOwners = new Map<string, Set<string>>();
  const allMessages = new Map<string, NormalizedEmail>();
  for (const chain of roots) {
    for (const messageId of chain.memberIds) {
      const owners = messageOwners.get(messageId) ?? new Set<string>();
      owners.add(chain.chainId);
      messageOwners.set(messageId, owners);
      const email = cache.get(messageId);
      if (email) allMessages.set(messageId, email);
    }
  }
  const ordered = [...allMessages.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.providerMessageId.localeCompare(b.providerMessageId));

  const overlapMessages = [...messageOwners.entries()].filter(([, owners]) => owners.size > 1);
  const overlapSummary = overlapMessages.map(([messageId, owners]) => {
    const chains = [...owners].map((id) => chainById.get(id)).filter((value): value is RootChain => Boolean(value));
    const originKinds = [...new Set(chains.flatMap((chain) => [...(chain.memberOrigins.get(messageId) ?? [])]))].sort();
    return {
      ownerCount: owners.size,
      sameRootOrderAcrossOwners: new Set(chains.map((chain) => chain.rootOrder.normalized)).size === 1,
      sameRootSenderAcrossOwners: new Set(chains.map((chain) => senderDomain(chain.root) ?? 'none')).size === 1,
      originKinds,
    };
  });

  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let snapshot = emptySnapshot();
  const purchaseOwner = new Map<string, string>();
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const email of ordered) {
    const owners = messageOwners.get(email.providerMessageId) ?? new Set<string>();
    const ownerChains = [...owners].map((id) => chainById.get(id)).filter((value): value is RootChain => Boolean(value));
    const document = buildEmailDocumentV1(email);
    const before = snapshot;
    const shadow = runPurchaseIdentityShadow({ userId: 'phase-e-100-private-learning-user', document, snapshot, merchantResolver });
    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0 || shadow.promotionReadiness.productionWrites !== 0) throw new Error('zero_write_zero_ai_invariant_failed');

    const decision = shadow.decision;
    const eligible = shadow.promotionReadiness.eligible;
    const action = shadow.promotionReadiness.action;
    const event = shadow.canonicalEvent;

    if (decision?.kind === 'LINKED') {
      const owner = purchaseOwner.get(decision.purchaseId);
      if (!owner || !owners.has(owner)) {
        const linkedChain = owner ? chainById.get(owner) : undefined;
        diagnostics.push({
          kind: 'cross_chain_link',
          caseId: opaque('phase-e-100-v4-diagnostic', email.providerMessageId),
          messageOwnerCount: owners.size,
          purchaseOwnerKnown: Boolean(owner),
          purchaseOwnerInMessageOwners: Boolean(owner && owners.has(owner)),
          messageOwnersShareRootOrder: new Set(ownerChains.map((chain) => chain.rootOrder.normalized)).size <= 1,
          messageOwnersShareRootSender: new Set(ownerChains.map((chain) => senderDomain(chain.root) ?? 'none')).size <= 1,
          linkedOwnerRootOrderMatchesAnyMessageOwner: Boolean(linkedChain && ownerChains.some((chain) => chain.rootOrder.normalized === linkedChain.rootOrder.normalized)),
          linkedOwnerSenderMatchesAnyMessageOwner: Boolean(linkedChain && ownerChains.some((chain) => senderDomain(chain.root) === senderDomain(linkedChain.root))),
          eventOrderMatchesLinkedOwnerRoot: Boolean(event?.orderIdNormalized && linkedChain && event.orderIdNormalized === linkedChain.rootOrder.normalized),
          eventOrderMatchesAnyMessageOwnerRoot: Boolean(event?.orderIdNormalized && ownerChains.some((chain) => event.orderIdNormalized === chain.rootOrder.normalized)),
          eventType: event?.eventType ?? null,
          sourceRole: event?.sourceRole ?? null,
          hasOrderIdentity: Boolean(event?.orderIdNormalized),
          hasTrackingIdentity: Boolean(event?.trackingIdNormalized),
          hasMerchantNamespace: Boolean(event?.merchantNamespace || event?.merchantId),
          reasonTypes: decision.reasons.map((reason) => reason.evidenceType),
          reasonStrengths: decision.reasons.map((reason) => reason.strength),
          messageOwnerOrigins: ownerChains.map((chain) => [...(chain.memberOrigins.get(email.providerMessageId) ?? [])].sort()),
        });
      }
    }

    if (eligible && action === 'CREATE_PURCHASE' && owners.size !== 1) {
      diagnostics.push({
        kind: 'non_unique_create_owner',
        caseId: opaque('phase-e-100-v4-diagnostic', email.providerMessageId),
        messageOwnerCount: owners.size,
        ownersShareRootOrder: new Set(ownerChains.map((chain) => chain.rootOrder.normalized)).size === 1,
        ownersShareRootSender: new Set(ownerChains.map((chain) => senderDomain(chain.root) ?? 'none')).size === 1,
        eventOrderMatchesAllOwnerRoots: Boolean(event?.orderIdNormalized && ownerChains.every((chain) => event.orderIdNormalized === chain.rootOrder.normalized)),
        eventType: event?.eventType ?? null,
        sourceRole: event?.sourceRole ?? null,
        hasOrderIdentity: Boolean(event?.orderIdNormalized),
        hasMerchantNamespace: Boolean(event?.merchantNamespace || event?.merchantId),
        creationAuthority: event?.purchaseCreationAuthority ?? null,
        messageOwnerOrigins: ownerChains.map((chain) => [...(chain.memberOrigins.get(email.providerMessageId) ?? [])].sort()),
      });
    }

    if (eligible && shadow.simulatedGraphMutated) {
      snapshot = shadow.simulatedSnapshot;
      if (action === 'CREATE_PURCHASE') {
        const beforeIds = new Set(before.purchases.map((purchase) => purchase.purchaseId));
        const added = snapshot.purchases.filter((purchase) => !beforeIds.has(purchase.purchaseId));
        if (added.length === 1 && owners.size === 1) purchaseOwner.set(added[0]!.purchaseId, [...owners][0]!);
      }
    }
  }

  const overlapAggregates = {
    messagesOwnedByMultipleChains: overlapMessages.length,
    overlapsSameRootOrder: overlapSummary.filter((row) => row.sameRootOrderAcrossOwners).length,
    overlapsSameRootSender: overlapSummary.filter((row) => row.sameRootSenderAcrossOwners).length,
    overlapsViaOrderSearch: overlapSummary.filter((row) => row.originKinds.includes('order')).length,
    overlapsViaTrackingSearch: overlapSummary.filter((row) => row.originKinds.includes('tracking')).length,
  };

  console.log(`PHASE_E_100_V4_DIAGNOSTICS ${JSON.stringify({ roots: roots.length, messages: ordered.length, overlapAggregates, diagnosticCases: diagnostics })}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '') : 'unknown';
  console.error(`Phase E 100 V4 diagnostics failed:${message}`);
  process.exit(1);
});