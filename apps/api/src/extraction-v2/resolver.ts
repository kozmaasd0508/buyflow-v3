import type { EvidenceBundle, EvidenceClaim, EvidenceField, ResolvedField } from './types.js';

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function claimsFor<T = unknown>(bundle: EvidenceBundle, field: EvidenceField): EvidenceClaim<T>[] {
  return bundle.claims.filter((claim): claim is EvidenceClaim<T> => claim.field === field);
}

/**
 * Generic deterministic resolver primitive.
 * Provider/merchant knowledge must live in evidence producers, not here.
 * Equal-precedence conflicting strong claims become conflict/REVIEW.
 * `equivalent` lets field resolvers normalize harmless representation differences
 * (for example identifier case) without losing the original winning value.
 */
export function resolveField<T>(input: {
  claims: EvidenceClaim<T>[];
  rank: (claim: EvidenceClaim<T>) => number;
  minimumConfidence?: number;
  equivalent?: (a: T, b: T) => boolean;
}): ResolvedField<T> {
  const minimumConfidence = input.minimumConfidence ?? 0;
  const equivalent = input.equivalent ?? ((a: T, b: T) => sameValue(a, b));
  const eligible = input.claims
    .filter((claim) => Number.isFinite(claim.confidence) && claim.confidence >= minimumConfidence)
    .sort((a, b) => {
      const rankDiff = input.rank(b) - input.rank(a);
      if (rankDiff !== 0) return rankDiff;
      return b.confidence - a.confidence;
    });

  if (eligible.length === 0) {
    return { value: null, confidence: null, status: 'missing', provenance: [] };
  }

  const bestRank = input.rank(eligible[0]!);
  const strongest = eligible.filter((claim) => input.rank(claim) === bestRank);
  const winner = strongest[0]!;
  const conflict = strongest.some((claim) => !equivalent(claim.value, winner.value));

  if (conflict) {
    return {
      value: null,
      confidence: null,
      status: 'conflict',
      provenance: strongest,
    };
  }

  return {
    value: winner.value,
    confidence: Math.max(...strongest.map((claim) => claim.confidence)),
    status: 'resolved',
    provenance: strongest,
  };
}
