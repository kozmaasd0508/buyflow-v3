import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { runExtractionEngineV2, type ExtractionEngineV2Result } from '../extraction-v2/engine-v2.js';
import {
  canonicalEventFromExtractionV2,
  type ExtractionV2CarrierIdentityResolver,
  type ExtractionV2MerchantIdentityResolver,
} from './extraction-v2-adapter.js';
import { PurchaseIdentityGraph } from './graph.js';
import { deriveMerchantSenderNamespace } from './merchant-sender-namespace.js';
import { evaluatePurchaseCreationAuthority } from './purchase-creation-authority.js';
import type { CanonicalEvent, CorrelationDecision, PurchaseIdentitySnapshot } from './types.js';

export interface PurchaseIdentityShadowInput {
  userId: string;
  document: EmailDocumentV1;
  snapshot: PurchaseIdentitySnapshot;
  merchantResolver?: ExtractionV2MerchantIdentityResolver;
  carrierResolver?: ExtractionV2CarrierIdentityResolver;
  runExtraction?: (document: EmailDocumentV1) => ExtractionEngineV2Result;
}

export interface PurchaseIdentityShadowResult {
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  extraction: ExtractionEngineV2Result;
  canonicalEvent: CanonicalEvent | null;
  decision: CorrelationDecision | null;
  simulatedGraphMutated: boolean;
  simulatedSnapshot: PurchaseIdentitySnapshot;
}

/**
 * End-to-end read-only shadow orchestration:
 * EmailDocumentV1 -> frozen Extraction Engine v2 -> direct canonical adapter ->
 * Purchase creation authority -> Purchase Identity Graph v2 decision/simulation.
 *
 * The graph may mutate its private in-memory clone to show the predicted result,
 * but this function performs no database writes and does not alter the caller's
 * snapshot. Legacy parser output is not an input.
 */
export function runPurchaseIdentityShadow(input: PurchaseIdentityShadowInput): PurchaseIdentityShadowResult {
  const extraction = (input.runExtraction ?? runExtractionEngineV2)(input.document);
  if (extraction.productionWrites !== 0 || extraction.aiCalls !== 0) {
    throw new Error('Purchase Identity shadow requires 0-write, 0-AI extraction.');
  }

  const graph = new PurchaseIdentityGraph(input.snapshot);
  const canonicalEvent = canonicalEventFromExtractionV2({
    userId: input.userId,
    document: input.document,
    extraction,
    merchantResolver: input.merchantResolver,
    carrierResolver: input.carrierResolver,
  });

  if (!canonicalEvent) {
    return {
      mode: 'shadow',
      productionWrites: 0,
      aiCalls: 0,
      extraction,
      canonicalEvent: null,
      decision: null,
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
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    extraction,
    canonicalEvent,
    decision: applied.decision,
    simulatedGraphMutated: applied.mutated,
    simulatedSnapshot: applied.snapshot,
  };
}
