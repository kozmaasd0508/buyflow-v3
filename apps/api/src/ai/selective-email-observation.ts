import type { NormalizedEmail } from '../email/types.js';
import { extractMailLensObservation } from './mail-lens-observation.js';
import type { EmailExtraction, OpenAIEmailExtractionResult } from './openai-email-extractor.js';
import {
  BUYFLOW_SOL_VERIFIER_MODEL,
  decideSolVerification,
  extractionsAgreeOnCoreIdentity,
  type SolVerificationDecision,
} from './sol-verification-policy.js';

type Observation = Awaited<ReturnType<typeof extractMailLensObservation>>;
type Extractor = typeof extractMailLensObservation;

export interface SelectiveAiObservationResult {
  selected: Observation;
  primary: Observation;
  verifier: Observation | null;
  selectedModel: string;
  aiCalls: number;
  verification: SolVerificationDecision & {
    attempted: boolean;
    completed: boolean;
    coreAgreement: boolean | null;
    verifierErrorType: string | null;
    selectionStrategy: 'luna_only' | 'sol_semantic_merge' | 'luna_fallback';
  };
}

function sameEvidenceEnvelope(a: Observation['evidence'], b: Observation['evidence']): boolean {
  return (
    a.subject === b.subject
    && a.receivedAt === b.receivedAt
    && a.bodyText === b.bodyText
    && JSON.stringify(a.from) === JSON.stringify(b.from)
    && JSON.stringify(a.fromDomains) === JSON.stringify(b.fromDomains)
    && JSON.stringify(a.normalization) === JSON.stringify(b.normalization)
  );
}


export function mergeVerifiedExtraction(
  primary: EmailExtraction,
  verifier: EmailExtraction,
): EmailExtraction {
  const evidenceIssues = [...new Set([
    ...(primary.evidence_issues ?? []),
    ...(verifier.evidence_issues ?? []),
  ])];

  // Luna remains the worker: preserve its detailed commerce extraction.
  // Sol is the verifier: override the semantic event boundary and phase, and
  // only fill durable identifiers that Luna missed. Never let verification
  // erase a Luna identifier or alter unrelated payment/product fields.
  return {
    ...primary,
    event_type: verifier.event_type,
    shipment_phase: verifier.shipment_phase ?? null,
    evidence_issues: evidenceIssues,
    order_number: primary.order_number ?? verifier.order_number,
    tracking_number: primary.tracking_number ?? verifier.tracking_number,
    invoice_number: primary.invoice_number ?? verifier.invoice_number,
    merchant: primary.merchant ?? verifier.merchant,
    merchant_legal_name: primary.merchant_legal_name ?? verifier.merchant_legal_name,
    carrier: primary.carrier ?? verifier.carrier,
    parcel_sender: primary.parcel_sender ?? verifier.parcel_sender,
    confidence: Math.min(primary.confidence, verifier.confidence),
  };
}

/**
 * Luna always performs the first pass. Sol is called only when the generic
 * risk policy requests verification. A successful Sol response becomes the
 * selected observation; verifier failures fail open to Luna because AI output
 * is still durable shadow-only evidence and cannot write commerce state.
 */
export async function extractWithSelectiveSolVerification(input: {
  email: NormalizedEmail;
  apiKey: string;
  primaryModel: string;
  verifierEnabled: boolean;
  verifierModel?: string;
  fetchImpl?: typeof fetch;
}, dependencies: { extract?: Extractor } = {}): Promise<SelectiveAiObservationResult> {
  const extract = dependencies.extract ?? extractMailLensObservation;
  const primary = await extract({
    email: input.email,
    apiKey: input.apiKey,
    model: input.primaryModel,
    fetchImpl: input.fetchImpl,
  });

  const decision = decideSolVerification(primary.result.extraction);
  if (!input.verifierEnabled || !decision.verify) {
    return {
      selected: primary,
      primary,
      verifier: null,
      selectedModel: input.primaryModel,
      aiCalls: 1,
      verification: {
        ...decision,
        attempted: false,
        completed: false,
        coreAgreement: null,
        verifierErrorType: null,
        selectionStrategy: 'luna_only',
      },
    };
  }

  const verifierModel = input.verifierModel ?? BUYFLOW_SOL_VERIFIER_MODEL;
  try {
    const verifier = await extract({
      email: input.email,
      apiKey: input.apiKey,
      model: verifierModel,
      fetchImpl: input.fetchImpl,
    });
    if (!sameEvidenceEnvelope(primary.evidence, verifier.evidence)) {
      throw new Error('SOL_VERIFIER_EVIDENCE_MISMATCH');
    }

    const selected: Observation = {
      ...verifier,
      result: {
        ...verifier.result,
        extraction: mergeVerifiedExtraction(
          primary.result.extraction,
          verifier.result.extraction,
        ),
      },
    };

    return {
      selected,
      primary,
      verifier,
      selectedModel: verifierModel,
      aiCalls: 2,
      verification: {
        ...decision,
        attempted: true,
        completed: true,
        coreAgreement: extractionsAgreeOnCoreIdentity(
          primary.result.extraction,
          verifier.result.extraction,
        ),
        verifierErrorType: null,
        selectionStrategy: 'sol_semantic_merge',
      },
    };
  } catch (error) {
    return {
      selected: primary,
      primary,
      verifier: null,
      selectedModel: input.primaryModel,
      aiCalls: 2,
      verification: {
        ...decision,
        attempted: true,
        completed: false,
        coreAgreement: null,
        verifierErrorType: error instanceof Error ? error.name : 'UnknownError',
        selectionStrategy: 'luna_fallback',
      },
    };
  }
}

export function sumAiUsage(
  primary: OpenAIEmailExtractionResult,
  verifier: OpenAIEmailExtractionResult | null,
) {
  const values = [primary, verifier].filter(
    (value): value is OpenAIEmailExtractionResult => Boolean(value),
  );
  const sum = (key: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedInputTokens') => {
    const present = values.map(value => value[key]).filter((value): value is number => value !== null);
    return present.length ? present.reduce((total, value) => total + value, 0) : null;
  };
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
  };
}
