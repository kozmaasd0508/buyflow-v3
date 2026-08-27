from pathlib import Path

v5 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v5-scoped.ts')
v7 = Path('apps/api/src/scripts/phase-e-100-real-lifecycle-v7-ai-hybrid.ts')

# The repository is public. Nothing from the real Gmail corpus or AI extraction
# may be persisted in plaintext. All persistent benchmark state goes through the
# AES-GCM cache helper and uses hashed filenames only.
v5_source = v5.read_text()
import_anchor = "import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';\n"
cache_import = "import { benchmarkCacheKey, currentV7AiInputFingerprint, loadEncryptedBenchmarkJson, saveEncryptedBenchmarkJson } from './v7-private-benchmark-cache.js';\n"
if import_anchor not in v5_source:
    raise SystemExit('fast_replay_v5_import_anchor_missing')
if cache_import not in v5_source:
    v5_source = v5_source.replace(import_anchor, import_anchor + cache_import, 1)

selection_start_anchor = "  const provider = new NylasEmailProvider({"
selection_end_anchor = "  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();"
selection_start = v5_source.find(selection_start_anchor)
selection_end = v5_source.find(selection_end_anchor, selection_start)
if selection_start < 0 or selection_end < 0:
    raise SystemExit('fast_replay_selection_anchor_missing')

selection_replacement = r'''  type FrozenRootChainV1 = {
    chainId: string;
    root: NormalizedEmail;
    rootDomain: string;
    rootOrder: AuditId;
    memberIds: string[];
    orderIds: Array<[string, string]>;
    trackingIds: Array<[string, string]>;
  };
  type FrozenCorpusV1 = {
    version: 1;
    selection: {
      candidateRefs: number;
      qualifyingRootCandidates: number;
      rootsExamined: number;
      isolatedRootsSkipped: number;
      journeys: number;
    };
    journeys: FrozenRootChainV1[];
    messageOwners: Array<[string, string[]]>;
    ordered: NormalizedEmail[];
  };

  const v7ReplayOnly = process.env.V7_BENCHMARK_REPLAY_ONLY === '1';
  const v7PrivateCacheSecret = process.env.V7_BENCHMARK_CACHE_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || '';
  const v7FrozenCorpusKey = benchmarkCacheKey([
    'v7-frozen-corpus-v1',
    'journeys=100',
    'messages=300',
    'window=2023-01-01..2026-08-01',
    'combined-root-source-v1',
  ]);
  const frozenCorpus = v7PrivateCacheSecret
    ? await loadEncryptedBenchmarkJson<FrozenCorpusV1>({
        scope: 'corpus',
        key: v7FrozenCorpusKey,
        secret: v7PrivateCacheSecret,
      })
    : null;

  let journeys: RootChain[];
  let messageOwners: Map<string, Set<string>>;
  let ordered: NormalizedEmail[];
  let v7FrozenCorpusHit = false;

  if (
    frozenCorpus?.version === 1
    && frozenCorpus.selection.journeys === JOURNEY_COUNT
    && frozenCorpus.journeys.length === JOURNEY_COUNT
    && frozenCorpus.ordered.length === 300
  ) {
    journeys = frozenCorpus.journeys.map((chain) => ({
      chainId: chain.chainId,
      root: chain.root,
      rootDomain: chain.rootDomain,
      rootOrder: chain.rootOrder,
      memberIds: new Set(chain.memberIds),
      orderIds: new Map(chain.orderIds),
      trackingIds: new Map(chain.trackingIds),
    }));
    messageOwners = new Map(frozenCorpus.messageOwners.map(([messageId, owners]) => [messageId, new Set(owners)]));
    ordered = frozenCorpus.ordered;
    v7FrozenCorpusHit = true;
    console.log('PHASE_E_100_V7_FROZEN_CORPUS ' + JSON.stringify({
      hit: true,
      journeys: journeys.length,
      messages: ordered.length,
    }));
    console.log(`PHASE_E_100_V5_SELECTION ${JSON.stringify(frozenCorpus.selection)}`);
  } else {
    if (v7ReplayOnly) {
      throw new Error(v7PrivateCacheSecret
        ? 'v7_frozen_corpus_cache_miss_replay_only'
        : 'v7_private_cache_secret_missing_replay_only');
    }

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
    journeys = [];
    const rootKeys = new Set<string>();
    let rootsExamined = 0;
    let qualifyingRootCandidates = 0;
    let isolatedRootsSkipped = 0;

    for (const ref of candidateRefs) {
      if (journeys.length >= JOURNEY_COUNT) break;
      const email = await hydrate(ref);
      const document = buildEmailDocumentV1(email);
      const ids = auditOrderIds(email, document);
      if (!qualifiesRoot(email, document, ids)) continue;
      const rootOrder = ids[0];
      const rootDomain = senderDomain(email);
      if (!rootOrder || !rootDomain) continue;
      qualifyingRootCandidates += 1;

      const rootKey = `${rootDomain}\u0000${rootOrder.normalized}`;
      if (rootKeys.has(rootKey)) continue;
      rootKeys.add(rootKey);
      rootsExamined += 1;

      const chain: RootChain = {
        chainId: opaque('phase-e-100-v5-chain', rootKey),
        root: email,
        rootDomain,
        rootOrder,
        memberIds: new Set([email.providerMessageId]),
        orderIds: new Map([[rootOrder.normalized, rootOrder.raw]]),
        trackingIds: new Map(),
      };
      await expandScopedJourney(provider, chain, hydrate);
      if (chain.memberIds.size < 2) {
        isolatedRootsSkipped += 1;
        continue;
      }
      journeys.push(chain);
    }

    const selection = {
      candidateRefs: candidateRefs.length,
      qualifyingRootCandidates,
      rootsExamined,
      isolatedRootsSkipped,
      journeys: journeys.length,
    };
    console.log(`PHASE_E_100_V5_SELECTION ${JSON.stringify(selection)}`);
    if (journeys.length !== JOURNEY_COUNT) throw new Error(`journey_selection_count_mismatch:${journeys.length}`);

    messageOwners = new Map<string, Set<string>>();
    const allMessages = new Map<string, NormalizedEmail>();
    for (const chain of journeys) {
      for (const messageId of chain.memberIds) {
        const owners = messageOwners.get(messageId) ?? new Set<string>();
        owners.add(chain.chainId);
        messageOwners.set(messageId, owners);
        const email = cache.get(messageId);
        if (email) allMessages.set(messageId, email);
      }
    }

    ordered = [...allMessages.values()].sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt) || a.providerMessageId.localeCompare(b.providerMessageId)).slice(0, 300);

    let saved = false;
    if (v7PrivateCacheSecret && ordered.length === 300) {
      saved = await saveEncryptedBenchmarkJson<FrozenCorpusV1>({
        scope: 'corpus',
        key: v7FrozenCorpusKey,
        secret: v7PrivateCacheSecret,
        value: {
          version: 1,
          selection,
          journeys: journeys.map((chain) => ({
            chainId: chain.chainId,
            root: chain.root,
            rootDomain: chain.rootDomain,
            rootOrder: chain.rootOrder,
            memberIds: [...chain.memberIds],
            orderIds: [...chain.orderIds.entries()],
            trackingIds: [...chain.trackingIds.entries()],
          })),
          messageOwners: [...messageOwners.entries()].map(([messageId, owners]) => [messageId, [...owners]]),
          ordered,
        },
      });
    }
    console.log('PHASE_E_100_V7_FROZEN_CORPUS ' + JSON.stringify({
      hit: false,
      saved,
      journeys: journeys.length,
      messages: ordered.length,
    }));
  }

'''

v5_source = v5_source[:selection_start] + selection_replacement + v5_source[selection_end:]
v5.write_text(v5_source)

v7_source = v7.read_text()

# AiCandidate gets a cache marker. This changes diagnostics only; evidence and
# promotion decisions are identical to the uncached path.
ai_candidate_anchor = """type AiCandidate = {
  result: OpenAIEmailExtractionResult;
  claims: EvidenceClaim[];
  rejectedOrderId: boolean;
  rejectedTrackingId: boolean;
};"""
ai_candidate_new = """type AiCandidate = {
  result: OpenAIEmailExtractionResult;
  claims: EvidenceClaim[];
  rejectedOrderId: boolean;
  rejectedTrackingId: boolean;
  cacheHit: boolean;
};"""
if ai_candidate_anchor not in v7_source:
    raise SystemExit('fast_replay_ai_candidate_anchor_missing')
v7_source = v7_source.replace(ai_candidate_anchor, ai_candidate_new, 1)

call_start_anchor = "async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1, journeyContext: string | null = null): Promise<AiCandidate> {"
call_start = v7_source.find(call_start_anchor)
call_end = v7_source.find("\n\nfunction needsSol", call_start)
if call_start < 0 or call_end < 0:
    raise SystemExit('fast_replay_call_model_anchor_missing')

call_model_replacement = r'''async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1, journeyContext: string | null = null): Promise<AiCandidate> {
  const structuredEvidence = buildStructuredEmailEvidence(document);
  const inputFingerprint = await currentV7AiInputFingerprint();
  const cacheSecret = process.env.V7_BENCHMARK_CACHE_KEY?.trim() || apiKey;
  const cacheKey = benchmarkCacheKey([
    'v7-ai-call-v1',
    inputFingerprint,
    model,
    document.subject ?? '',
    [...document.sender.domains].sort().join(','),
    document.text,
    document.html ?? '',
    structuredEvidence,
    journeyContext ?? '',
  ]);

  let result = await loadEncryptedBenchmarkJson<OpenAIEmailExtractionResult>({
    scope: 'ai',
    key: cacheKey,
    secret: cacheSecret,
  });
  const cacheHit = Boolean(result);

  if (!result) {
    if (process.env.V7_BENCHMARK_REPLAY_ONLY === '1') {
      throw new Error('v7_ai_cache_miss_replay_only:' + model);
    }
    try {
      result = await extractEmailWithOpenAIResult({
        apiKey,
        model,
        subject: document.subject ?? undefined,
        fromDomains: document.sender.domains,
        bodyText: document.text,
        bodyHtml: document.html,
        structuredEvidence,
        journeyContext,
        fetchImpl: retryingFetch as typeof fetch,
      });
    } catch {
      throw new Error('ai_model_call_failed:' + model);
    }
    await saveEncryptedBenchmarkJson({
      scope: 'ai',
      key: cacheKey,
      secret: cacheSecret,
      value: result,
    });
  }

  const rejectedOrderId = Boolean(result.extraction.order_number && !signalContainsId(document.signals.orderNumbers, result.extraction.order_number));
  const rejectedTrackingId = Boolean(result.extraction.tracking_number && !signalContainsId(document.signals.trackingNumbers, result.extraction.tracking_number));
  return {
    result,
    claims: aiClaims(document, result.extraction, model),
    rejectedOrderId,
    rejectedTrackingId,
    cacheHit,
  };
}'''
v7_source = v7_source[:call_start] + call_model_replacement + v7_source[call_end:]

# Track true provider calls separately from encrypted cache hits.
declaration_anchor = """  let rejectedSolTrackingIds = 0;
  let processed = 0;"""
declaration_new = """  let rejectedSolTrackingIds = 0;
  let lunaCacheHits = 0;
  let solCacheHits = 0;
  let processed = 0;"""
if declaration_anchor not in v7_source:
    raise SystemExit('fast_replay_usage_declaration_anchor_missing')
v7_source = v7_source.replace(declaration_anchor, declaration_new, 1)

luna_usage_anchor = "    addUsage(lunaUsage, luna.result);"
luna_usage_new = """    if (luna.cacheHit) lunaCacheHits += 1;
    else addUsage(lunaUsage, luna.result);"""
if luna_usage_anchor not in v7_source:
    raise SystemExit('fast_replay_luna_usage_anchor_missing')
v7_source = v7_source.replace(luna_usage_anchor, luna_usage_new, 1)

sol_usage_anchor = "      addUsage(solUsage, sol.result);"
sol_usage_new = """      if (sol.cacheHit) solCacheHits += 1;
      else addUsage(solUsage, sol.result);"""
if sol_usage_anchor not in v7_source:
    raise SystemExit('fast_replay_sol_usage_anchor_missing')
v7_source = v7_source.replace(sol_usage_anchor, sol_usage_new, 1)

progress_anchor = "console.log('PHASE_E_100_V7_AI_PROGRESS ' + JSON.stringify({ processed, total: ordered.length, lunaCalls: lunaUsage.calls, solCalls: solUsage.calls }));"
progress_new = "console.log('PHASE_E_100_V7_AI_PROGRESS ' + JSON.stringify({ processed, total: ordered.length, lunaCalls: lunaUsage.calls, lunaCacheHits, solCalls: solUsage.calls, solCacheHits }));"
if progress_anchor not in v7_source:
    raise SystemExit('fast_replay_progress_anchor_missing')
v7_source = v7_source.replace(progress_anchor, progress_new, 1)

# Build one encrypted frozen Extraction snapshot after a successful AI pass.
# Graph-only changes can replay this snapshot without recomputing semantic AI.
loop_start_anchor = "  for (const email of ordered) {\n    const document = buildEmailDocumentV1(email);\n    const base = baseExtractions.get(email.providerMessageId)!;\n    const journeyContext = buildPurchaseJourneyContext(document, lunaJourneySnapshot, 5, journeyEventMemory);"
loop_start = v7_source.find(loop_start_anchor)
loop_end_anchor = "\n  const lunaScore = replayLane({"
loop_end = v7_source.find(loop_end_anchor, loop_start)
if loop_start < 0 or loop_end < 0:
    raise SystemExit('fast_replay_ai_loop_anchor_missing')
original_loop = v7_source[loop_start:loop_end]

# The original loop body stays byte-for-byte the same inside the miss branch.
# On a snapshot hit we rebuild only read-only journey memory from cached
# augmented extractions so current Graph rules are still exercised.
snapshot_wrapped = r'''  const v7AiInputFingerprint = await currentV7AiInputFingerprint();
  const v7ExtractionSnapshotKey = benchmarkCacheKey([
    'v7-luna-augmented-extraction-snapshot-v1',
    v7AiInputFingerprint,
    'frozen-corpus-v1-100x300',
  ]);
  type FrozenExtractionSnapshotV1 = {
    version: 1;
    entries: Array<[string, ExtractionEngineV2Result]>;
    rejectedLunaOrderIds: number;
    rejectedLunaTrackingIds: number;
  };
  const v7CachedExtractions = v7PrivateCacheSecret
    ? await loadEncryptedBenchmarkJson<FrozenExtractionSnapshotV1>({
        scope: 'extractions',
        key: v7ExtractionSnapshotKey,
        secret: v7PrivateCacheSecret,
      })
    : null;
  const v7ExtractionSnapshotHit = Boolean(
    v7CachedExtractions?.version === 1
    && v7CachedExtractions.entries.length === ordered.length
  );

  if (v7ExtractionSnapshotHit && v7CachedExtractions) {
    for (const [messageId, extraction] of v7CachedExtractions.entries) {
      lunaExtractions.set(messageId, extraction);
      hybridExtractions.set(messageId, extraction);
    }
    rejectedLunaOrderIds = v7CachedExtractions.rejectedLunaOrderIds;
    rejectedLunaTrackingIds = v7CachedExtractions.rejectedLunaTrackingIds;
    lunaCacheHits = v7CachedExtractions.entries.length;
    processed = ordered.length;

    for (const email of ordered) {
      const document = buildEmailDocumentV1(email);
      const journeyContext = buildPurchaseJourneyContext(document, lunaJourneySnapshot, 5, journeyEventMemory);
      if (journeyContext) messagesWithJourneyContext += 1;
      const lunaAugmented = lunaExtractions.get(email.providerMessageId);
      if (!lunaAugmented) throw new Error('v7_cached_extraction_missing');
      const journeyBeforeSnapshot = lunaJourneySnapshot;
      const journeyShadow = runGraphFromExtraction({
        userId: 'phase-e-100-v7-private-user',
        document,
        snapshot: lunaJourneySnapshot,
        extraction: lunaAugmented,
        merchantResolver: journeyMerchantResolver,
      });
      if (journeyShadow.promotionReadiness.eligible && journeyShadow.simulatedGraphMutated) {
        let memoryPurchaseId: string | null = null;
        if (journeyShadow.promotionReadiness.action === 'CREATE_PURCHASE') {
          const beforePurchaseIds = new Set(journeyBeforeSnapshot.purchases.map((purchase) => purchase.purchaseId));
          memoryPurchaseId = journeyShadow.simulatedSnapshot.purchases.find(
            (purchase) => !beforePurchaseIds.has(purchase.purchaseId),
          )?.purchaseId ?? null;
        } else if (
          journeyShadow.promotionReadiness.action === 'LINK_EVENT'
          && journeyShadow.decision?.kind === 'LINKED'
        ) {
          memoryPurchaseId = journeyShadow.decision.purchaseId;
        }
        lunaJourneySnapshot = journeyShadow.simulatedSnapshot;
        const event = journeyShadow.canonicalEvent;
        if (event && memoryPurchaseId) {
          journeyEventMemory.push({
            purchaseId: memoryPurchaseId,
            eventType: event.eventType,
            receivedAt: event.receivedAt,
            sourceRole: event.sourceRole ?? null,
            merchantNamespace: event.merchantNamespace ?? null,
            orderId: event.orderIdNormalized ?? event.orderIdRaw,
            trackingId: event.trackingIdNormalized ?? event.trackingIdRaw,
            carrierId: event.carrierId ?? null,
            invoiceId: event.invoiceIdNormalized ?? event.invoiceIdRaw,
            paymentReference: event.paymentReference,
            amount: event.amount,
            currency: event.currency,
          });
        }
      }
    }
    console.log('PHASE_E_100_V7_EXTRACTION_CACHE ' + JSON.stringify({
      hit: true,
      entries: v7CachedExtractions.entries.length,
      replayOnly: v7ReplayOnly,
    }));
    console.log('PHASE_E_100_V7_AI_PROGRESS ' + JSON.stringify({
      processed,
      total: ordered.length,
      lunaCalls: 0,
      lunaCacheHits,
      solCalls: 0,
      solCacheHits,
    }));
  } else {
    if (v7ReplayOnly) throw new Error('v7_extraction_snapshot_cache_miss_replay_only');
'''+ original_loop + r'''

    const savedExtractionSnapshot = v7PrivateCacheSecret
      ? await saveEncryptedBenchmarkJson<FrozenExtractionSnapshotV1>({
          scope: 'extractions',
          key: v7ExtractionSnapshotKey,
          secret: v7PrivateCacheSecret,
          value: {
            version: 1,
            entries: [...lunaExtractions.entries()],
            rejectedLunaOrderIds,
            rejectedLunaTrackingIds,
          },
        })
      : false;
    console.log('PHASE_E_100_V7_EXTRACTION_CACHE ' + JSON.stringify({
      hit: false,
      saved: savedExtractionSnapshot,
      entries: lunaExtractions.size,
      replayOnly: false,
    }));
  }
'''
v7_source = v7_source[:loop_start] + snapshot_wrapped + v7_source[loop_end:]

# Report actual calls/cost separately from cache reuse and make replay state
# explicit without logging any private values.
model_usage_luna_anchor = """      luna: {
        ...lunaUsage,
        estimatedCostUsd: Number(estimatedCostUsd(lunaUsage, 'luna').toFixed(6)),
      },"""
model_usage_luna_new = """      luna: {
        ...lunaUsage,
        cacheHits: lunaCacheHits,
        estimatedCostUsd: Number(estimatedCostUsd(lunaUsage, 'luna').toFixed(6)),
      },"""
if model_usage_luna_anchor not in v7_source:
    raise SystemExit('fast_replay_luna_report_anchor_missing')
v7_source = v7_source.replace(model_usage_luna_anchor, model_usage_luna_new, 1)

model_usage_sol_anchor = """      sol: {
        ...solUsage,
        estimatedCostUsd: Number(estimatedCostUsd(solUsage, 'sol').toFixed(6)),
      },"""
model_usage_sol_new = """      sol: {
        ...solUsage,
        cacheHits: solCacheHits,
        estimatedCostUsd: Number(estimatedCostUsd(solUsage, 'sol').toFixed(6)),
      },"""
if model_usage_sol_anchor not in v7_source:
    raise SystemExit('fast_replay_sol_report_anchor_missing')
v7_source = v7_source.replace(model_usage_sol_anchor, model_usage_sol_new, 1)

production_anchor = "    productionWrites: 0,"
production_new = """    benchmarkCache: {
      replayOnly: v7ReplayOnly,
      frozenCorpusHit: v7FrozenCorpusHit,
      extractionSnapshotHit: v7ExtractionSnapshotHit,
    },
    productionWrites: 0,"""
# Replace the last occurrence in aiReport, not any earlier helper object.
idx = v7_source.rfind(production_anchor)
if idx < 0:
    raise SystemExit('fast_replay_report_cache_anchor_missing')
v7_source = v7_source[:idx] + production_new + v7_source[idx + len(production_anchor):]

v7.write_text(v7_source)
