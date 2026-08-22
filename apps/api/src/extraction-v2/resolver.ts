import type { EvidenceBundle, EvidenceClaim, EvidenceField, ResolvedField } from './types.js';

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function claimsFor<T = unknown>(bundle: EvidenceBundle, field: EvidenceField): EvidenceClaim<T>[] {
  return bundle.claims.filter((claim): claim is EvidenceClaim<T> => claim.field === field);
}

/**
 * Generic deterministic resolver primitive.
 *
 * Important: this does not know merchants/providers. Callers provide precedence
 * through `rank`; equal-rank conflicting strong claims become conflict/REVIEW.
 */
export function resolveField<T>(input: {
  claims: EvidenceClaim<T>[];
  rank: (claim: EvidenceClaim<T>) => number;
  minimumConfidence?: number;
}): ResolvedField<T> {
  const minimumConfidence = input.minimumConfidence ?? 0;
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
  const conflict = strongest.some((claim) => !sameValue(claim.value, winner.value));

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
