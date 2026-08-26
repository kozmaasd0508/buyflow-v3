import { spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'phase-e-100-real-lifecycle-v5-scoped.ts');
const generatedPath = join(here, '.phase-e-100-real-lifecycle-v7-ai-generated.ts');

const oldImports = `import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';\nimport { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';\nimport type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';\n`;

const newImports = `import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { canonicalEventFromExtractionV2 } from '../purchase-identity-v2/extraction-v2-adapter.js';
import { PurchaseIdentityGraph } from '../purchase-identity-v2/graph.js';
import { deriveMerchantSenderNamespace } from '../purchase-identity-v2/merchant-sender-namespace.js';
import { evaluatePromotionReadiness } from '../purchase-identity-v2/promotion-readiness.js';
import { evaluatePurchaseCreationAuthority } from '../purchase-identity-v2/purchase-creation-authority.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';
import { extractEmailWithOpenAIResult, type EmailExtraction, type OpenAIEmailExtractionResult } from '../ai/openai-email-extractor.js';
import { runExtractionEngineV2, type ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import { evidenceEligibleForResolution } from '../extraction-v2/source-role-eligibility.js';
import { resolveCommerceEvent } from '../extraction-v2/field-resolvers.js';
import { validateResolvedCommerceEvent } from '../extraction-v2/cross-field-validator.js';
import type { EvidenceClaim, EvidenceProduct } from '../extraction-v2/types.js';
`;

const oldRootQuery = "const ROOT_QUERY = 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases';";
const newRootQuery = "const ROOT_QUERY = '__PHASE_E_V7_COMBINED_ROOT_SOURCE__';";

const v6SourcePatch = String.raw`
const V7_ROOT_SENTINEL = '__PHASE_E_V7_COMBINED_ROOT_SOURCE__';
const V7_ROOT_SOURCES = [
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases', cap: 1200 },
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:rendelés', cap: 800 },
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:megrendelés', cap: 800 },
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:"order"', cap: 800 },
] as const;

const v7ProviderPrototype = NylasEmailProvider.prototype as any;
const v7OriginalSearchMessages = v7ProviderPrototype.searchMessages;
const v7OriginalGetMessage = v7ProviderPrototype.getMessage;
const v7CombinedRootCache = new WeakMap<object, NormalizedEmail[]>();

function v7Sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function v7RetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:429|rate.?limit|service.?unavailable|\b503\b|timeout|temporarily.?unavailable)/i.test(message);
}

async function v7WithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!v7RetryableError(error) || attempt === 4) throw error;
      await v7Sleep(1000 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function v7CombinedRoots(provider: object): Promise<NormalizedEmail[]> {
  const cached = v7CombinedRootCache.get(provider);
  if (cached) return cached;
  const combined: NormalizedEmail[] = [];
  const seen = new Set<string>();
  const sourceCounts: number[] = [];

  for (const source of V7_ROOT_SOURCES) {
    let cursor: string | undefined;
    let loaded = 0;
    let uniqueAdded = 0;
    while (loaded < source.cap) {
      const page: any = await v7WithRetry(() => v7OriginalSearchMessages.call(provider, {
        query: source.query,
        limit: Math.min(20, source.cap - loaded),
        ...(cursor ? { cursor } : {}),
      }));
      const messages: NormalizedEmail[] = page.messages ?? [];
      loaded += messages.length;
      for (const message of messages) {
        if (seen.has(message.providerMessageId)) continue;
        seen.add(message.providerMessageId);
        combined.push(message);
        uniqueAdded += 1;
      }
      if (!page.nextCursor || messages.length === 0) break;
      cursor = page.nextCursor;
    }
    sourceCounts.push(uniqueAdded);
  }

  v7CombinedRootCache.set(provider, combined);
  console.log('PHASE_E_100_V7_SOURCE_COUNTS ' + JSON.stringify({ sourceUniqueAdds: sourceCounts, combinedCandidates: combined.length }));
  return combined;
}

v7ProviderPrototype.searchMessages = async function v7SearchMessages(args: any): Promise<any> {
  if (args?.query === V7_ROOT_SENTINEL) {
    const roots = await v7CombinedRoots(this);
    const rawCursor = typeof args.cursor === 'string' && args.cursor.startsWith('v7:') ? args.cursor.slice(3) : '0';
    const offset = /^\d+$/.test(rawCursor) ? Number(rawCursor) : 0;
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 20));
    const messages = roots.slice(offset, offset + limit);
    const nextOffset = offset + messages.length;
    return { messages, ...(nextOffset < roots.length ? { nextCursor: 'v7:' + String(nextOffset) } : {}) };
  }
  return v7WithRetry(() => v7OriginalSearchMessages.call(this, args));
};

v7ProviderPrototype.getMessage = async function v7GetMessage(messageId: string): Promise<NormalizedEmail> {
  return v7WithRetry(() => v7OriginalGetMessage.call(this, messageId));
};
`;

const aiHelpers = String.raw`
type AiCandidate = {
  result: OpenAIEmailExtractionResult;
  claims: EvidenceClaim[];
  rejectedOrderId: boolean;
  rejectedTrackingId: boolean;
};

type LaneScore = {
  lane: string;
  journeys: number;
  discoveredMessages: number;
  automaticCreates: number;
  automaticLinks: number;
  blocked: number;
  journeysWithPurchase: number;
  journeysWithAutomaticLifecycleLinks: number;
  wrongAutomaticLinks: number;
  duplicateCreates: number;
  nonAcceptanceCreates: number;
  decisionCounts: Record<string, number>;
  eventCounts: Record<string, number>;
  promotionReasonCounts: Record<string, number>;
  unsafeCount: number;
};

function normalizedEvidenceId(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function signalContainsId(values: string[], candidate: string | null): boolean {
  const needle = normalizedEvidenceId(candidate);
  return Boolean(needle && values.some((value) => normalizedEvidenceId(value) === needle));
}

function normalizedText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function aiClaim<T>(field: EvidenceClaim<T>['field'], value: T, confidence: number, model: string, qualifiers: string[] = []): EvidenceClaim<T> {
  return {
    field,
    value,
    confidence: Math.max(0, Math.min(1, confidence)),
    source: 'body',
    extractorId: 'openai-semantic-shadow',
    extractorVersion: model,
    qualifiers,
  };
}

function currencyValue(value: string | null): 'HUF' | 'EUR' | 'USD' | 'GBP' | null {
  const upper = value?.trim().toUpperCase() ?? '';
  return upper === 'HUF' || upper === 'EUR' || upper === 'USD' || upper === 'GBP' ? upper : null;
}

function aiClaims(document: EmailDocumentV1, extraction: EmailExtraction, model: string): AiCandidate['claims'] {
  const confidence = Number.isFinite(extraction.confidence) ? extraction.confidence : 0;
  const claims: EvidenceClaim[] = [];
  if (extraction.event_type) claims.push(aiClaim('event_type', extraction.event_type, confidence, model));

  if (extraction.merchant) {
    const haystack = normalizedText((document.subject ?? '') + '\n' + document.text);
    const merchant = normalizedText(extraction.merchant);
    if (merchant.length >= 2 && haystack.includes(merchant)) {
      claims.push(aiClaim('merchant', extraction.merchant, confidence, model));
    }
  }

  if (extraction.order_number && signalContainsId(document.signals.orderNumbers, extraction.order_number)) {
    claims.push(aiClaim('order_number', extraction.order_number, confidence, model));
  }
  if (extraction.tracking_number && signalContainsId(document.signals.trackingNumbers, extraction.tracking_number)) {
    claims.push(aiClaim('tracking_number', extraction.tracking_number, confidence, model));
  }

  if (extraction.carrier) {
    const carrierNorm = normalizedText(extraction.carrier);
    const structuralCarrier = document.signals.couriers.some((value) => {
      const candidate = normalizedText(value);
      return candidate === carrierNorm || candidate.includes(carrierNorm) || carrierNorm.includes(candidate);
    });
    if (structuralCarrier || document.sender.domains.some(isCarrierSenderDomain)) {
      claims.push(aiClaim('carrier', extraction.carrier, confidence, model));
    }
  }

  if (typeof extraction.total === 'number' && Number.isFinite(extraction.total)) {
    const currency = currencyValue(extraction.currency);
    const matchingMoney = document.signals.amounts.some((item) =>
      Math.abs(item.amount - extraction.total!) < 0.000001 && (!currency || item.currency === currency));
    if (matchingMoney) {
      claims.push(aiClaim('total', extraction.total, confidence, model));
      if (currency) claims.push(aiClaim('currency', currency, confidence, model));
    }
  }

  if (extraction.payment_status && confidence >= 0.95) {
    claims.push(aiClaim('payment_status', extraction.payment_status, confidence, model));
  }

  for (const product of extraction.products.slice(0, 50)) {
    const nameNorm = normalizedText(product.name);
    const structural = document.signals.products.find((candidate) => normalizedText(candidate.name) === nameNorm);
    if (!structural || product.confidence < 0.90) continue;
    const value: EvidenceProduct = {
      name: structural.name,
      quantity: structural.quantity ?? null,
      unitPrice: structural.unitPrice ?? null,
      totalPrice: structural.totalPrice ?? null,
      currency: structural.currency ?? null,
    };
    claims.push(aiClaim('product', value, product.confidence, model));
  }

  return claims;
}

function augmentExtraction(base: ExtractionEngineV2Result, claims: EvidenceClaim[], model: string): ExtractionEngineV2Result {
  const evidence = {
    bundle: { claims: [...base.evidence.bundle.claims, ...claims] },
    ranExtractors: [
      ...base.evidence.ranExtractors,
      { id: 'openai-semantic-shadow', version: model, claimCount: claims.length },
    ],
  };
  const resolved = resolveCommerceEvent(evidenceEligibleForResolution(evidence.bundle));
  const validation = validateResolvedCommerceEvent(resolved);
  return {
    ...base,
    evidence,
    resolved,
    validation,
    reviewRequired: resolved.reviewRequired || validation.reviewRequired,
  };
}

async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 5) return response;
      try { await response.body?.cancel(); } catch {}
    } catch (error) {
      lastError = error;
      if (attempt === 5) throw error;
    }
    await v7Sleep(1000 * Math.min(16, 2 ** attempt));
  }
  throw lastError;
}

async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1): Promise<AiCandidate> {
  let result: OpenAIEmailExtractionResult;
  try {
    result = await extractEmailWithOpenAIResult({
      apiKey,
      model,
      subject: document.subject ?? undefined,
      fromDomains: document.sender.domains,
      bodyText: document.text,
      fetchImpl: retryingFetch as typeof fetch,
    });
  } catch {
    throw new Error('ai_model_call_failed:' + model);
  }
  const rejectedOrderId = Boolean(result.extraction.order_number && !signalContainsId(document.signals.orderNumbers, result.extraction.order_number));
  const rejectedTrackingId = Boolean(result.extraction.tracking_number && !signalContainsId(document.signals.trackingNumbers, result.extraction.tracking_number));
  return {
    result,
    claims: aiClaims(document, result.extraction, model),
    rejectedOrderId,
    rejectedTrackingId,
  };
}

function needsSol(base: ExtractionEngineV2Result, luna: AiCandidate): string[] {
  const reasons: string[] = [];
  const extraction = luna.result.extraction;
  if (extraction.confidence < 0.90) reasons.push('LOW_CONFIDENCE');
  if (extraction.event_type === 'other') reasons.push('OTHER_EVENT');
  if (luna.rejectedOrderId) reasons.push('UNVERIFIED_ORDER_ID');
  if (luna.rejectedTrackingId) reasons.push('UNVERIFIED_TRACKING_ID');
  if (base.resolved.eventType.status === 'resolved' && base.resolved.eventType.value && base.resolved.eventType.value !== extraction.event_type) {
    reasons.push('DETERMINISTIC_EVENT_CONFLICT');
  }
  if (base.reviewRequired) reasons.push('DETERMINISTIC_REVIEW');
  return [...new Set(reasons)];
}

function runGraphFromExtraction(input: {
  userId: string;
  document: EmailDocumentV1;
  snapshot: PurchaseIdentitySnapshot;
  extraction: ExtractionEngineV2Result;
  merchantResolver: ReturnType<typeof buildTestProtocolMerchantIdentityRegistry>;
}) {
  const graph = new PurchaseIdentityGraph(input.snapshot);
  const canonicalEvent = canonicalEventFromExtractionV2({
    userId: input.userId,
    document: input.document,
    extraction: input.extraction,
    merchantResolver: input.merchantResolver,
  });
  if (!canonicalEvent) {
    return {
      canonicalEvent: null,
      decision: null,
      promotionReadiness: evaluatePromotionReadiness({ event: null, decision: null }),
      simulatedGraphMutated: false,
      simulatedSnapshot: graph.snapshot(),
    };
  }
  canonicalEvent.merchantNamespace = deriveMerchantSenderNamespace(canonicalEvent);
  const creationAuthority = evaluatePurchaseCreationAuthority({
    document: input.document,
    eventType: canonicalEvent.eventType,
    sourceRole: canonicalEvent.sourceRole ?? 'unknown',
    orderId: canonicalEvent.orderIdNormalized ?? canonicalEvent.orderIdRaw,
  });
  canonicalEvent.purchaseCreationAuthority = creationAuthority.authority;
  canonicalEvent.purchaseCreationReasons = creationAuthority.reasons;
  const applied = graph.applyEvent(canonicalEvent);
  return {
    canonicalEvent,
    decision: applied.decision,
    promotionReadiness: evaluatePromotionReadiness({ event: canonicalEvent, decision: applied.decision }),
    simulatedGraphMutated: applied.mutated,
    simulatedSnapshot: applied.snapshot,
  };
}

function replayLane(input: {
  lane: string;
  ordered: NormalizedEmail[];
  messageOwners: Map<string, Set<string>>;
  extractions: Map<string, ExtractionEngineV2Result>;
  journeys: RootChain[];
}): LaneScore {
  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  let snapshot = emptySnapshot();
  const purchaseOwner = new Map<string, string>();
  const chainPurchase = new Map<string, string>();
  const chainsWithLinks = new Set<string>();
  const decisionCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  const promotionReasonCounts: Record<string, number> = {};
  let automaticCreates = 0;
  let automaticLinks = 0;
  let blocked = 0;
  let wrongAutomaticLinks = 0;
  let duplicateCreates = 0;
  let nonAcceptanceCreates = 0;
  let unsafeCount = 0;

  for (const email of input.ordered) {
    const owners = input.messageOwners.get(email.providerMessageId) ?? new Set<string>();
    const document = buildEmailDocumentV1(email);
    const extraction = input.extractions.get(email.providerMessageId);
    if (!extraction) throw new Error('lane_extraction_missing:' + input.lane);
    const before = snapshot;
    const shadow = runGraphFromExtraction({
      userId: 'phase-e-100-v7-private-user',
      document,
      snapshot,
      extraction,
      merchantResolver,
    });
    const decision = shadow.decision;
    const eligible = shadow.promotionReadiness.eligible;
    const action = shadow.promotionReadiness.action;
    inc(decisionCounts, decision?.kind);
    inc(eventCounts, shadow.canonicalEvent?.eventType);
    for (const reason of shadow.promotionReadiness.reasons) inc(promotionReasonCounts, reason);

    if (decision?.kind === 'LINKED') {
      const owner = purchaseOwner.get(decision.purchaseId);
      if (!owner || !owners.has(owner)) {
        wrongAutomaticLinks += 1;
        unsafeCount += 1;
      }
    }

    if (eligible && action === 'CREATE_PURCHASE') {
      automaticCreates += 1;
      if (owners.size !== 1) {
        unsafeCount += 1;
      } else {
        const chainId = [...owners][0]!;
        if (explicitNonAcceptance(document)) {
          nonAcceptanceCreates += 1;
          unsafeCount += 1;
        }
        if (chainPurchase.has(chainId)) {
          duplicateCreates += 1;
          unsafeCount += 1;
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
        if (added.length !== 1 || owners.size !== 1) {
          unsafeCount += 1;
        } else {
          const chainId = [...owners][0]!;
          purchaseOwner.set(added[0]!.purchaseId, chainId);
          if (!chainPurchase.has(chainId)) chainPurchase.set(chainId, added[0]!.purchaseId);
        }
      }
      if (action === 'LINK_EVENT' && decision?.kind === 'LINKED') {
        const owner = purchaseOwner.get(decision.purchaseId);
        if (owner && owners.has(owner)) chainsWithLinks.add(owner);
      }
    }
  }

  return {
    lane: input.lane,
    journeys: input.journeys.length,
    discoveredMessages: input.ordered.length,
    automaticCreates,
    automaticLinks,
    blocked,
    journeysWithPurchase: chainPurchase.size,
    journeysWithAutomaticLifecycleLinks: chainsWithLinks.size,
    wrongAutomaticLinks,
    duplicateCreates,
    nonAcceptanceCreates,
    decisionCounts,
    eventCounts,
    promotionReasonCounts,
    unsafeCount,
  };
}

function addUsage(target: { input: number; output: number; cached: number; calls: number }, result: OpenAIEmailExtractionResult): void {
  target.calls += 1;
  target.input += result.inputTokens ?? 0;
  target.output += result.outputTokens ?? 0;
  target.cached += result.cachedInputTokens ?? 0;
}

function estimatedCostUsd(usage: { input: number; output: number; cached: number }, model: 'luna' | 'sol'): number {
  const uncached = Math.max(0, usage.input - usage.cached);
  const rates = model === 'luna'
    ? { input: 0.20, cached: 0.02, output: 1.20 }
    : { input: 4.00, cached: 0.40, output: 20.00 };
  return (uncached * rates.input + usage.cached * rates.cached + usage.output * rates.output) / 1_000_000;
}
`;

const replayReplacement = String.raw`
  const baseExtractions = new Map<string, ExtractionEngineV2Result>();
  for (const email of ordered) {
    baseExtractions.set(email.providerMessageId, runExtractionEngineV2(buildEmailDocumentV1(email)));
  }

  const baseline = replayLane({
    lane: 'deterministic',
    ordered,
    messageOwners,
    extractions: baseExtractions,
    journeys,
  });
  console.log('PHASE_E_100_V7_BASELINE ' + JSON.stringify(baseline));
  if (
    baseline.journeys !== 100
    || baseline.discoveredMessages !== 340
    || baseline.automaticCreates !== 26
    || baseline.automaticLinks !== 13
    || baseline.wrongAutomaticLinks !== 0
    || baseline.duplicateCreates !== 0
    || baseline.nonAcceptanceCreates !== 0
    || baseline.unsafeCount !== 0
  ) {
    throw new Error('v7_deterministic_baseline_mismatch');
  }

  const apiKey = secret('OPENAI_API_KEY');
  const lunaExtractions = new Map<string, ExtractionEngineV2Result>();
  const hybridExtractions = new Map<string, ExtractionEngineV2Result>();
  const lunaUsage = { input: 0, output: 0, cached: 0, calls: 0 };
  const solUsage = { input: 0, output: 0, cached: 0, calls: 0 };
  const fallbackReasons: Record<string, number> = {};
  let rejectedLunaOrderIds = 0;
  let rejectedLunaTrackingIds = 0;
  let rejectedSolOrderIds = 0;
  let rejectedSolTrackingIds = 0;
  let processed = 0;

  for (const email of ordered) {
    const document = buildEmailDocumentV1(email);
    const base = baseExtractions.get(email.providerMessageId)!;
    const luna = await callModel(apiKey, 'gpt-5.6-luna', document);
    addUsage(lunaUsage, luna.result);
    if (luna.rejectedOrderId) rejectedLunaOrderIds += 1;
    if (luna.rejectedTrackingId) rejectedLunaTrackingIds += 1;
    lunaExtractions.set(email.providerMessageId, augmentExtraction(base, luna.claims, 'gpt-5.6-luna'));

    const reasons = needsSol(base, luna);
    for (const reason of reasons) inc(fallbackReasons, reason);
    if (reasons.length > 0) {
      const sol = await callModel(apiKey, 'gpt-5.6-sol', document);
      addUsage(solUsage, sol.result);
      if (sol.rejectedOrderId) rejectedSolOrderIds += 1;
      if (sol.rejectedTrackingId) rejectedSolTrackingIds += 1;
      hybridExtractions.set(email.providerMessageId, augmentExtraction(base, sol.claims, 'gpt-5.6-sol'));
    } else {
      hybridExtractions.set(email.providerMessageId, augmentExtraction(base, luna.claims, 'gpt-5.6-luna'));
    }

    processed += 1;
    if (processed % 50 === 0 || processed === ordered.length) {
      console.log('PHASE_E_100_V7_AI_PROGRESS ' + JSON.stringify({ processed, total: ordered.length, lunaCalls: lunaUsage.calls, solCalls: solUsage.calls }));
    }
  }

  const lunaScore = replayLane({
    lane: 'luna',
    ordered,
    messageOwners,
    extractions: lunaExtractions,
    journeys,
  });
  const hybridScore = replayLane({
    lane: 'luna_sol_hybrid',
    ordered,
    messageOwners,
    extractions: hybridExtractions,
    journeys,
  });

  const aiReport = {
    population: { journeys: journeys.length, messages: ordered.length },
    baseline,
    luna: lunaScore,
    hybrid: hybridScore,
    modelUsage: {
      luna: {
        ...lunaUsage,
        estimatedCostUsd: Number(estimatedCostUsd(lunaUsage, 'luna').toFixed(6)),
      },
      sol: {
        ...solUsage,
        estimatedCostUsd: Number(estimatedCostUsd(solUsage, 'sol').toFixed(6)),
      },
    },
    fallbackReasons,
    rejectedIdentifiers: {
      lunaOrder: rejectedLunaOrderIds,
      lunaTracking: rejectedLunaTrackingIds,
      solOrder: rejectedSolOrderIds,
      solTracking: rejectedSolTrackingIds,
    },
    productionWrites: 0,
  };

  console.log('PHASE_E_100_V7_AI_HYBRID_SCORE ' + JSON.stringify(aiReport));
  if (lunaScore.unsafeCount > 0 || hybridScore.unsafeCount > 0) {
    throw new Error('unsafe_v7_ai_score');
  }
`;

function buildGeneratedSource(source: string): string {
  if (!source.includes(oldImports)) throw new Error('v7_import_anchor_missing');
  if (!source.includes(oldRootQuery)) throw new Error('v7_root_query_anchor_missing');
  if (!source.includes('const ROOT_CANDIDATE_CAP = 1200;')) throw new Error('v7_candidate_cap_anchor_missing');
  const mainAnchor = 'async function main(): Promise<void> {';
  if (!source.includes(mainAnchor)) throw new Error('v7_main_anchor_missing');
  const replayStartAnchor = '  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();';
  const replayStart = source.indexOf(replayStartAnchor);
  const mainCatchAnchor = '\n}\n\nmain().catch';
  const replayEnd = source.indexOf(mainCatchAnchor, replayStart);
  if (replayStart < 0 || replayEnd < 0) throw new Error('v7_replay_anchor_missing');

  let generated = source
    .replace(oldImports, newImports)
    .replace(oldRootQuery, newRootQuery)
    .replace('const ROOT_CANDIDATE_CAP = 1200;', 'const ROOT_CANDIDATE_CAP = 3600;')
    .replace(mainAnchor, v6SourcePatch + '\n' + aiHelpers + '\n' + mainAnchor)
    .replaceAll('PHASE_E_100_V5_SELECTION', 'PHASE_E_100_V7_SELECTION')
    .replaceAll('phase-e-100-v5-chain', 'phase-e-100-v7-chain');

  const freshReplayStart = generated.indexOf(replayStartAnchor);
  const freshReplayEnd = generated.indexOf(mainCatchAnchor, freshReplayStart);
  if (freshReplayStart < 0 || freshReplayEnd < 0) throw new Error('v7_replay_anchor_shifted');
  generated = generated.slice(0, freshReplayStart) + replayReplacement + generated.slice(freshReplayEnd);
  return generated;
}

async function runGenerated(): Promise<number> {
  const child = spawn(process.execPath, ['--import', 'tsx', generatedPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const source = await readFile(sourcePath, 'utf8');
  await writeFile(generatedPath, buildGeneratedSource(source), 'utf8');
  try {
    const code = await runGenerated();
    if (code !== 0) process.exitCode = code;
  } finally {
    await unlink(generatedPath).catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '') : 'unknown';
  console.error(`Phase E 100 real lifecycle V7 AI hybrid wrapper failed:${message}`);
  process.exitCode = 1;
});
