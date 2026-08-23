import type { CanonicalEvent, EvidenceConflict } from './types.js';

export interface HardConflictGateResult {
  blocked: boolean;
  conflicts: EvidenceConflict[];
}

/**
 * Any unresolved hard contradiction blocks automatic correlation.
 * The gate is intentionally pure and does not score or guess a winner.
 */
export function evaluateHardConflictGate(event: CanonicalEvent): HardConflictGateResult {
  const conflicts = (event.conflicts ?? []).filter((conflict) => conflict.severity === 'hard');
  return {
    blocked: conflicts.length > 0,
    conflicts,
  };
}
