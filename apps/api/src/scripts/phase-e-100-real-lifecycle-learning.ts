import { createHash } from 'node:crypto';
import { NylasEmailProvider } from '../email/nylas-provider.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1, type EmailDocumentV1 } from '../ingestion/email-document.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

const ROOT_QUERY = 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases';
const SEARCH_WINDOW = 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash';
const ROOT_CANDIDATE_CAP = 1200;
const ROOT_COUNT = 100;
const MAX_ORDER_TOKENS = 4;
const MAX_TRACKING_TOKENS = 4;

type AuditId = { raw: string; normalized: string };
type RootChain = {
  chainId: string;
  root: NormalizedEmail;
  rootOrder: AuditId;
  memberIds: Set<string>;
  orderIds: Map<string, string>;
  trackingIds: Map<string, string>;
};

function secret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('secret_missing');
  return value;
}

function ascii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .toUpperCase();
}

function normalizeId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

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
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) addAuditId(out, match[1]);
  }
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

function rootLikePhysicalOrder(email: NormalizedEmail, document: EmailDocumentV1, orderIds: AuditId[]): boolean {
  const subject = ascii(email.subject ?? '').trim();
  if (/^(?:RE|FW|FWD):/.test(subject) || orderIds.length === 0) return false;
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);

  const newOrder = [
    /SIKERES\s+(?:MEG)?RENDELES/,
    /(?:MEG)?RENDELES(?:ED|EDET|ET|UNK|T|ESE)?\s+(?:MEGEROSIT|VISSZAIGAZOL|ROGZIT|MEGKAPT|FOGADT|LETREJOTT|ERKEZETT)/,
    /MEGKAPTUK\s+(?:A\s+)?(?:MEG)?RENDELES/,
    /KOSZONJUK.{0,120}(?:RENDELTEL|VASARLAST|RENDELEST)/,
    /ORDER\s+(?:CONFIRMATION|RECEIVED|CONFIRMED|PLACED)/,
  ].some((pattern) => pattern.test(text));
  if (!newOrder) return false;

  const physical = /SZALLITASI\s+(?:MOD|ADAT|CIM)|HAZHOZSZALLITAS|CSOMAG(?:PONT|AUTOMATA)|FUTAR(?:SZOLGALAT)?|UTANVET|FOXPOST|GLS|DPD|MPL|PACKETA|DELIVERY\s+(?:METHOD|ADDRESS)|SHIPPING\s+(?:METHOD|ADDRESS)/.test(text);
  if (!physical) return false;

  const digitalOnly = /AUTOMATIKUSAN\s+MEGUJULO\s+ELOFIZETES|ELOFIZETESED|DIGITALIS\s+(?:LICENC|TARTALOM)|SOFTWARE\s+LICENSE|DOWNLOAD\s+ONLY|SUBSCRIPTION\s+RENEWAL/.test(text);
  return !digitalOnly;
}

function explicitRelation(email: NormalizedEmail, document: EmailDocumentV1): boolean {
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  return /SPLIT\s+(?:ORDER|FROM)|PARENT\s+ORDER|SZULO\s+RENDELES|EREDETI\s+RENDELES|HELYETTESITO\s+RENDELES|REPLACEMENT\s+(?:FOR|ORDER)|RESZRENDELES/.test(text);
}

function explicitNonAcceptance(document: EmailDocumentV1): boolean {
  const text = ascii(`${document.subject ?? ''}\n${document.text}`);
  return /NEM\s+JELENTI.{0,120}SZERZODES\s+LETREJOTTET|NEM\s+JELENTI.{0,120}(?:MEG)?RENDELES\s+ELFOGADASAT|ORDER\s+HAS\s+NOT\s+(?:YET\s+)?BEEN\s+ACCEPTED|DOES\s+NOT\s+CONSTITUTE.{0,100}(?:ACCEPTANCE|CONTRACT)/.test(text);
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
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

function inc(map: Record<string, number>, key: string | null | undefined): void {
  const safe = key || 'none';
  map[safe] = (map[safe] ?? 0) + 1;
}

async function main(): Promise<void> {
  const provider = new NylasEmailProvider({
    apiKey: secret('NYLAS_API_KEY'),
    grantId: secret('NYLAS_GRANT_ID'),
    apiUri: process.env.NYLAS_API_URI?.trim() || 'https://api.eu.nylas.com',
  });

  const cache = new Map<string, NormalizedEmail>();
  const hydrate = async (ref: NormalizedEmail): Promise<NormalizedEmail> => {
    const cached = cache.get(ref.providerMessageId);
    if (cached) return cached;
    const full = await provider.getMessage(ref.providerMessageId);
    cache.set(full.providerMessageId, full);
    return full;
  };

  const candidateRefs = await upToN(provider, ROOT_QUERY, ROOT_CANDIDATE_CAP);
  const roots: RootChain[] = [];
  const rootKeys = new Set<string>();

  for (const ref of candidateRefs) {
    if (roots.length >= ROOT_COUNT) break;
    const email = await hydrate(ref);
    const document = buildEmailDocumentV1(email);
    const ids = auditOrderIds(email, document);
    if (!rootLikePhysicalOrder(email, document, ids)) continue;
    const rootOrder = ids[0];
    if (!rootOrder) continue;
    const key = `${senderDomain(email) ?? 'unknown'}\u0000${rootOrder.normalized}`;
    if (rootKeys.has(key)) continue;
    rootKeys.add(key);
    roots.push({
      chainId: opaque('phase-e-100-chain', email.providerMessageId),
      root: email,
      rootOrder,
      memberIds: new Set([email.providerMessageId]),
      orderIds: new Map([[rootOrder.normalized, rootOrder.raw]]),
      trackingIds: new Map(),
    });
  }

  if (roots.length !== ROOT_COUNT) throw new Error(`root_selection_count_mismatch:${roots.length}`);

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
        chain.memberIds.add(email.providerMessageId);
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
        chain.memberIds.add(email.providerMessageId);
      }
    }
  }

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

  const ordered = [...allMessages.values()].sort((a, b) => {
    const byTime = a.receivedAt.localeCompare(b.receivedAt);
    return byTime !== 0 ? byTime : a.providerMessageId.localeCompare(b.providerMessageId);
  });

  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let snapshot = emptySnapshot();
  const purchaseOwner = new Map<string, string>();
  const chainPurchase = new Map<string, string>();
  const chainsWithLinks = new Set<string>();
  const unsafe: Array<{ caseId: string; reason: string }> = [];
  const decisionCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  const authorityCounts: Record<string, number> = {};
  const promotionReasonCounts: Record<string, number> = {};
  let automaticCreates = 0;
  let automaticLinks = 0;
  let blocked = 0;
  let wrongAutomaticLinks = 0;
  let duplicateCreates = 0;
  let nonAcceptanceCreates = 0;

  for (const email of ordered) {
    const owners = messageOwners.get(email.providerMessageId) ?? new Set<string>();
    const document = buildEmailDocumentV1(email);
    const before = snapshot;
    const shadow = runPurchaseIdentityShadow({
      userId: 'phase-e-100-private-learning-user',
      document,
      snapshot,
      merchantResolver,
    });

    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0 || shadow.promotionReadiness.productionWrites !== 0) {
      throw new Error('zero_write_zero_ai_invariant_failed');
    }

    const caseId = opaque('phase-e-100-case', email.providerMessageId);
    const decision = shadow.decision;
    const eligible = shadow.promotionReadiness.eligible;
    const action = shadow.promotionReadiness.action;
    inc(decisionCounts, decision?.kind);
    inc(eventCounts, shadow.canonicalEvent?.eventType);
    inc(authorityCounts, shadow.canonicalEvent?.purchaseCreationAuthority);
    for (const reason of shadow.promotionReadiness.reasons) inc(promotionReasonCounts, reason);

    if (decision?.kind === 'LINKED') {
      const owner = purchaseOwner.get(decision.purchaseId);
      if (!owner || !owners.has(owner)) {
        wrongAutomaticLinks += 1;
        unsafe.push({ caseId, reason: 'CROSS_CHAIN_LINK' });
      }
    }

    if (eligible && action === 'CREATE_PURCHASE') {
      automaticCreates += 1;
      const ownerList = [...owners];
      if (ownerList.length !== 1) {
        unsafe.push({ caseId, reason: 'CREATE_WITHOUT_UNIQUE_CHAIN' });
      } else {
        const chainId = ownerList[0]!;
        if (explicitNonAcceptance(document)) {
          nonAcceptanceCreates += 1;
          unsafe.push({ caseId, reason: 'CREATE_ON_EXPLICIT_NON_ACCEPTANCE' });
        }
        if (chainPurchase.has(chainId)) {
          duplicateCreates += 1;
          unsafe.push({ caseId, reason: 'DUPLICATE_PURCHASE_CREATE' });
        }
      }
    } else if (eligible && action === 'LINK_EVENT') {
      automaticLinks += 1;
    } else {
      blocked += 1;
    }

    if (eligible && shadow.simulatedGraphMutated) {
      snapshot = shadow.simulatedSnapshot;
      if (action === 'CREATE_PURCHASE') {
        const beforeIds = new Set(before.purchases.map((purchase) => purchase.purchaseId));
        const added = snapshot.purchases.filter((purchase) => !beforeIds.has(purchase.purchaseId));
        const ownerList = [...owners];
        if (added.length !== 1 || ownerList.length !== 1) {
          unsafe.push({ caseId, reason: 'CREATE_GRAPH_DELTA_INVALID' });
        } else {
          purchaseOwner.set(added[0]!.purchaseId, ownerList[0]!);
          if (!chainPurchase.has(ownerList[0]!)) chainPurchase.set(ownerList[0]!, added[0]!.purchaseId);
        }
      }
      if (action === 'LINK_EVENT' && decision?.kind === 'LINKED') {
        const owner = purchaseOwner.get(decision.purchaseId);
        if (owner && owners.has(owner)) chainsWithLinks.add(owner);
      }
    }
  }

  const uniqueOrderOwners = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const chain of roots) {
    for (const orderNorm of chain.orderIds.keys()) {
      const current = uniqueOrderOwners.get(orderNorm);
      if (!current) uniqueOrderOwners.set(orderNorm, chain.chainId);
      else if (current !== chain.chainId) ambiguous.add(orderNorm);
    }
  }
  for (const value of ambiguous) uniqueOrderOwners.delete(value);

  let crossChainMergedPurchases = 0;
  for (const purchase of snapshot.purchases) {
    const represented = new Set<string>();
    for (const order of snapshot.orders.filter((item) => item.purchaseId === purchase.purchaseId)) {
      const owner = uniqueOrderOwners.get(normalizeId(order.orderId));
      if (owner) represented.add(owner);
    }
    if (represented.size > 1) {
      crossChainMergedPurchases += 1;
      unsafe.push({ caseId: opaque('phase-e-100-purchase', purchase.purchaseId), reason: 'FINAL_CROSS_CHAIN_MERGE' });
    }
  }

  const report = {
    roots: roots.length,
    candidatesScanned: candidateRefs.length,
    discoveredMessages: ordered.length,
    automaticCreates,
    automaticLinks,
    blocked,
    chainsWithPurchase: chainPurchase.size,
    chainsWithAutomaticLifecycleLinks: chainsWithLinks.size,
    wrongAutomaticLinks,
    duplicateCreates,
    nonAcceptanceCreates,
    crossChainMergedPurchases,
    decisionCounts,
    eventCounts,
    authorityCounts,
    promotionReasonCounts,
    productionWrites: 0,
    aiCalls: 0,
    unsafe,
  };

  console.log(`PHASE_E_100_REAL_LIFECYCLE_LEARNING_SCORE ${JSON.stringify(report)}`);
  if (unsafe.length > 0) throw new Error('unsafe_first_score');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '') : 'unknown';
  console.error(`Phase E 100 real lifecycle learning audit failed:${message}`);
  process.exit(1);
});