import { createHash } from 'node:crypto';
import { NylasEmailProvider } from '../email/nylas-provider.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1, type EmailDocumentV1 } from '../ingestion/email-document.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';

const ROOT_QUERY = 'after:2026/01/01 before:2026/08/01 -in:spam -in:trash {subject:megrendelés subject:rendelés subject:"order confirmation" subject:"order received"}';
const SEARCH_WINDOW = 'after:2026/01/01 before:2026/08/01 -in:spam -in:trash';
const ROOT_CANDIDATES = 100;
const ROOT_COUNT = 15;
const MAX_CHAIN_ORDER_TOKENS = 5;
const MAX_CHAIN_TRACKING_TOKENS = 5;

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
  if (/^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(normalized)) return null;
  if (/^(?:19|20)\d{2}[./-](?:0?[1-9]|1[0-2])[./-](?:0?[1-9]|[12]\d|3[01])$/.test(cleaned)) return null;
  if (/^(?:RESZLETEI|AZONOSITO|SZAM|TERM[EÉ]K)$/i.test(cleaned)) return null;
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
    /\b(?:MEGRENDELES|RENDELES)\s+ADATOK[\s\S]{0,120}?\bAZONOSITO\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b(?:RENDELES|MEGRENDELES)\s*#\s*([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b([A-Z0-9][A-Z0-9./-]{3,35})\s+(?:SZAMU\s+)?(?:MEG)?RENDELES(?:ET|EDET|ED|E|I|EN|ROL)?\b/g,
    /\b(?:ORDER\s*(?:NUMBER|NO|ID)?|ORDER\s*#)\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) addAuditId(out, match[1]);
  }

  // Audit-only fallback: the shared document normalizer may expose an explicit
  // order identity even when line wrapping defeats the independent regexes.
  for (const value of document.signals.orderNumbers) addAuditId(out, value);
  return [...out.entries()].map(([normalized, raw]) => ({ raw, normalized }));
}

function auditTrackingIds(email: NormalizedEmail, document = buildEmailDocumentV1(email)): AuditId[] {
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  const out = new Map<string, string>();
  const patterns = [
    /\b(?:TRACKING(?:\s*(?:NUMBER|NO|ID))?|NYOMKOVETESI\s*(?:SZAM|AZONOSITO)|CSOMAG(?:SZAM|AZONOSITOSZAM|AZONOSITO)|KULDEMENY(?:SZAM|AZONOSITO))\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,31})\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) addAuditId(out, match[1]);
  }
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
  if (/^(?:RE|FW|FWD):/.test(subject)) return false;
  if (orderIds.length === 0) return false;

  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  const newOrder = [
    /SIKERES\s+RENDELES/,
    /RENDELES(?:ED|EDET|ET|UNK|T)?\s+(?:MEGEROSIT|ROGZIT|MEGKAPT|FOGADT|LETREJOTT)/,
    /MEGRENDELES(?:ED|EDET|ET|ESE|UNK|T)?\s+(?:MEGEROSIT|VISSZAIGAZOL|ROGZIT|MEGKAPT|FOGADT|ERKEZETT)/,
    /AUTOMATA\s+MEGRENDELES\s+VISSZAIGAZOLAS/,
    /WEBARUHAZUNKBAN\s+RENDELEST\s+ADOTT\s+LE/,
    /KOSZONJUK.{0,100}(?:RENDELTEL|VASARLAST|RENDELEST)/,
    /MEGKAPTUK\s+(?:A\s+)?(?:MEG)?RENDELES/,
    /ORDER\s+(?:CONFIRMATION|RECEIVED|CONFIRMED)/,
  ].some((pattern) => pattern.test(text));
  if (!newOrder) return false;

  const physical = /SZALLITASI\s+(?:MOD|ADAT)|HAZHOZSZALLITAS|CSOMAG(?:PONT|AUTOMATA)|FUTAR(?:SZOLGALAT)?|UTANVET|DELIVERY\s+METHOD|SHIPPING\s+METHOD|DELIVERY\s+ADDRESS/.test(text);
  if (!physical) return false;

  const digitalOnly = /AUTOMATIKUSAN\s+MEGUJULO\s+ELOFIZETES|ELOFIZETESED|DIGITALIS\s+(?:LICENC|TARTALOM)|SOFTWARE\s+LICENSE|DOWNLOAD\s+ONLY/.test(text);
  return !digitalOnly;
}

function explicitRelation(email: NormalizedEmail, document: EmailDocumentV1): boolean {
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  return /PODELJENA\s+PORUDZBINA|SPLIT\s+(?:ORDER|FROM)|PARENT\s+ORDER|SZULO\s+RENDELES|EREDeti\s+RENDELES|HELYETTESITO\s+RENDELES|REPLACEMENT\s+(?:FOR|ORDER)/i.test(text);
}

function auditExplicitNonAcceptance(document: EmailDocumentV1): boolean {
  const text = ascii(`${document.subject ?? ''}\n${document.text}`);
  return /NEM\s+JELENTI.{0,100}SZERZODES\s+LETREJOTTET|NEM\s+JELENTI.{0,120}(?:MEG)?RENDELES\s+ELFOGADASAT|AJANLATTETELNEK\s+NEM\s+MINOSUL|ORDER\s+HAS\s+NOT\s+(?:YET\s+)?BEEN\s+ACCEPTED|DOES\s+NOT\s+CONSTITUTE.{0,100}(?:ACCEPTANCE|CONTRACT)/.test(text);
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
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
  if (out.length !== take) throw new Error('freeze_count_mismatch');
  return out;
}

async function searchUpTo(provider: NylasEmailProvider, token: string, take = 50): Promise<NormalizedEmail[]> {
  const safeToken = token.replace(/["\r\n]/g, '').trim();
  if (!safeToken) return [];
  const query = `"${safeToken}" ${SEARCH_WINDOW}`;
  const page = await provider.searchMessages({ query, limit: take });
  return page.messages.slice(0, take);
}

async function main(): Promise<void> {
  const provider = new NylasEmailProvider({
    apiKey: secret('NYLAS_API_KEY'),
    grantId: secret('NYLAS_GRANT_ID'),
    apiUri: process.env.NYLAS_API_URI?.trim() || 'https://api.eu.nylas.com',
  });

  const hydrateCache = new Map<string, NormalizedEmail>();
  const hydrate = async (email: NormalizedEmail): Promise<NormalizedEmail> => {
    const cached = hydrateCache.get(email.providerMessageId);
    if (cached) return cached;
    const full = await provider.getMessage(email.providerMessageId);
    hydrateCache.set(full.providerMessageId, full);
    return full;
  };

  const roots: RootChain[] = [];
  const rootKeys = new Set<string>();
  const candidateRefs = await firstN(provider, ROOT_QUERY, ROOT_CANDIDATES);

  for (const candidateRef of candidateRefs) {
    if (roots.length >= ROOT_COUNT) break;
    const email = await hydrate(candidateRef);
    const document = buildEmailDocumentV1(email);
    const ids = auditOrderIds(email, document);
    if (!rootLikePhysicalOrder(email, document, ids)) continue;
    const rootOrder = ids[0];
    if (!rootOrder) continue;
    const key = `${senderDomain(email) ?? 'unknown'}\u0000${rootOrder.normalized}`;
    if (rootKeys.has(key)) continue;
    rootKeys.add(key);
    roots.push({
      chainId: opaque('phase-e-15-chain', email.providerMessageId),
      root: email,
      rootOrder,
      memberIds: new Set([email.providerMessageId]),
      orderIds: new Map([[rootOrder.normalized, rootOrder.raw]]),
      trackingIds: new Map(),
    });
  }

  if (roots.length !== ROOT_COUNT) throw new Error('root_selection_count_mismatch');

  for (const chain of roots) {
    const pendingOrders: string[] = [chain.rootOrder.raw];
    const searchedOrders = new Set<string>();
    const pendingTracking: string[] = [];
    const searchedTracking = new Set<string>();

    while (pendingOrders.length > 0 && searchedOrders.size < MAX_CHAIN_ORDER_TOKENS) {
      const token = pendingOrders.shift();
      if (!token) continue;
      const tokenNorm = normalizeId(token);
      if (!tokenNorm || searchedOrders.has(tokenNorm)) continue;
      searchedOrders.add(tokenNorm);

      for (const ref of await searchUpTo(provider, token)) {
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
          for (const relatedOrder of auditOrderIds(email, document)) {
            if (!chain.orderIds.has(relatedOrder.normalized)) {
              chain.orderIds.set(relatedOrder.normalized, relatedOrder.raw);
              pendingOrders.push(relatedOrder.raw);
            }
          }
        }
      }
    }

    while (pendingTracking.length > 0 && searchedTracking.size < MAX_CHAIN_TRACKING_TOKENS) {
      const token = pendingTracking.shift();
      if (!token) continue;
      const tokenNorm = normalizeId(token);
      if (!tokenNorm || searchedTracking.has(tokenNorm)) continue;
      searchedTracking.add(tokenNorm);

      for (const ref of await searchUpTo(provider, token)) {
        const email = await hydrate(ref);
        chain.memberIds.add(email.providerMessageId);
      }
    }
  }

  const messageOwners = new Map<string, Set<string>>();
  const allMessages = new Map<string, NormalizedEmail>();
  for (const chain of roots) {
    allMessages.set(chain.root.providerMessageId, chain.root);
    for (const messageId of chain.memberIds) {
      const owners = messageOwners.get(messageId) ?? new Set<string>();
      owners.add(chain.chainId);
      messageOwners.set(messageId, owners);
      const email = hydrateCache.get(messageId);
      if (email) allMessages.set(messageId, email);
    }
  }

  const orderedMessages = [...allMessages.values()].sort((a, b) => {
    const time = a.receivedAt.localeCompare(b.receivedAt);
    return time !== 0 ? time : a.providerMessageId.localeCompare(b.providerMessageId);
  });

  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let snapshot = emptySnapshot();
  const purchaseOwner = new Map<string, string>();
  const chainPurchase = new Map<string, string>();
  const eligibleLinksByChain = new Map<string, number>();
  const reviewsByChain = new Map<string, number>();
  const unsafe: Array<{ caseId: string; reason: string }> = [];
  const rows: Array<Record<string, unknown>> = [];
  let automaticCreates = 0;
  let automaticLinks = 0;
  let blocked = 0;
  let wrongAutomaticLinks = 0;
  let duplicateCreates = 0;
  let nonAcceptanceCreates = 0;

  for (const email of orderedMessages) {
    const owners = messageOwners.get(email.providerMessageId) ?? new Set<string>();
    const document = buildEmailDocumentV1(email);
    const beforeSnapshot = snapshot;
    const shadow = runPurchaseIdentityShadow({
      userId: 'phase-e-15-real-lifecycle-private-user',
      document,
      snapshot,
      merchantResolver,
    });

    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0 || shadow.promotionReadiness.productionWrites !== 0) {
      throw new Error('zero_write_zero_ai_invariant_failed');
    }

    const caseId = opaque('phase-e-15-case', email.providerMessageId);
    const decision = shadow.decision;
    const eligible = shadow.promotionReadiness.eligible;
    const action = shadow.promotionReadiness.action;
    let targetOwnerMatch: boolean | null = null;

    if (decision?.kind === 'LINKED') {
      const owner = purchaseOwner.get(decision.purchaseId);
      targetOwnerMatch = Boolean(owner && owners.has(owner));
      if (!targetOwnerMatch) {
        wrongAutomaticLinks += 1;
        unsafe.push({ caseId, reason: 'CROSS_CHAIN_LINK' });
      }
    }

    if (decision?.kind === 'REVIEW' || decision?.kind === 'PENDING') {
      for (const chainId of owners) reviewsByChain.set(chainId, (reviewsByChain.get(chainId) ?? 0) + 1);
    }

    if (eligible && action === 'CREATE_PURCHASE') {
      automaticCreates += 1;
      const ownerList = [...owners];
      if (ownerList.length !== 1) {
        unsafe.push({ caseId, reason: 'CREATE_WITHOUT_UNIQUE_CHAIN' });
      } else {
        const chainId = ownerList[0]!;
        if (auditExplicitNonAcceptance(document)) {
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
        const beforeIds = new Set(beforeSnapshot.purchases.map((purchase) => purchase.purchaseId));
        const added = snapshot.purchases.filter((purchase) => !beforeIds.has(purchase.purchaseId));
        const ownerList = [...owners];
        if (added.length !== 1 || ownerList.length !== 1) {
          unsafe.push({ caseId, reason: 'CREATE_GRAPH_DELTA_INVALID' });
        } else {
          const purchaseId = added[0]!.purchaseId;
          const chainId = ownerList[0]!;
          purchaseOwner.set(purchaseId, chainId);
          if (!chainPurchase.has(chainId)) chainPurchase.set(chainId, purchaseId);
        }
      }
      if (action === 'LINK_EVENT' && decision?.kind === 'LINKED') {
        const owner = purchaseOwner.get(decision.purchaseId);
        if (owner && owners.has(owner)) eligibleLinksByChain.set(owner, (eligibleLinksByChain.get(owner) ?? 0) + 1);
      }
    }

    if (eligible || decision?.kind === 'LINKED' || decision?.kind === 'REVIEW' || decision?.kind === 'PENDING' || shadow.canonicalEvent) {
      rows.push({
        caseId,
        ownerCount: owners.size,
        expectedChain: owners.size === 1 ? [...owners][0] : null,
        day: email.receivedAt.slice(0, 10),
        senderDomain: senderDomain(email),
        eventType: shadow.canonicalEvent?.eventType ?? null,
        decision: decision?.kind ?? null,
        promotionEligible: eligible,
        promotionAction: action,
        targetOwnerMatch,
        creationAuthority: shadow.canonicalEvent?.purchaseCreationAuthority ?? null,
        explicitNonAcceptance: auditExplicitNonAcceptance(document),
      });
    }
  }

  const uniqueOrderOwners = new Map<string, string>();
  const ambiguousOrderOwners = new Set<string>();
  for (const chain of roots) {
    for (const orderNorm of chain.orderIds.keys()) {
      const current = uniqueOrderOwners.get(orderNorm);
      if (!current) uniqueOrderOwners.set(orderNorm, chain.chainId);
      else if (current !== chain.chainId) ambiguousOrderOwners.add(orderNorm);
    }
  }
  for (const ambiguous of ambiguousOrderOwners) uniqueOrderOwners.delete(ambiguous);

  let crossChainMergedPurchases = 0;
  for (const purchase of snapshot.purchases) {
    const representedChains = new Set<string>();
    for (const order of snapshot.orders.filter((item) => item.purchaseId === purchase.purchaseId)) {
      const chainId = uniqueOrderOwners.get(normalizeId(order.orderId));
      if (chainId) representedChains.add(chainId);
    }
    if (representedChains.size > 1) {
      crossChainMergedPurchases += 1;
      unsafe.push({ caseId: opaque('phase-e-15-purchase', purchase.purchaseId), reason: 'FINAL_CROSS_CHAIN_MERGE' });
    }
  }

  const chainSummaries = roots.map((chain) => ({
    chainId: chain.chainId,
    rootDay: chain.root.receivedAt.slice(0, 10),
    senderDomain: senderDomain(chain.root),
    discoveredMessages: chain.memberIds.size,
    orderIdentityCount: chain.orderIds.size,
    trackingIdentityCount: chain.trackingIds.size,
    purchaseCreated: chainPurchase.has(chain.chainId),
    eligibleLifecycleLinks: eligibleLinksByChain.get(chain.chainId) ?? 0,
    reviewOrPending: reviewsByChain.get(chain.chainId) ?? 0,
  }));

  const report = {
    roots: roots.length,
    candidatePool: ROOT_CANDIDATES,
    discoveredMessages: orderedMessages.length,
    automaticCreates,
    automaticLinks,
    blocked,
    chainsWithPurchase: chainPurchase.size,
    chainsWithAutomaticLifecycleLinks: chainSummaries.filter((chain) => chain.eligibleLifecycleLinks > 0).length,
    wrongAutomaticLinks,
    duplicateCreates,
    nonAcceptanceCreates,
    crossChainMergedPurchases,
    productionWrites: 0,
    aiCalls: 0,
    unsafe,
    chainSummaries,
    rows,
  };

  console.log(`PHASE_E_15_REAL_LIFECYCLE_BLIND_SCORE ${JSON.stringify(report)}`);
  if (unsafe.length > 0) throw new Error('unsafe_first_score');
}

main().catch(() => {
  console.error('Phase E 15 real lifecycle blind audit failed');
  process.exit(1);
});
