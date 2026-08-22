import type { EvidenceBundle, EvidenceClaim } from './types.js';

const DIRECT_CARRIER_QUALIFIERS = new Set([
  'direct_carrier_sender',
  'authenticated_direct_carrier_sender',
]);

function isDirectCarrierSourceClaim(claim: EvidenceClaim): boolean {
  return claim.field === 'carrier'
    && (claim.qualifiers ?? []).some((qualifier) => DIRECT_CARRIER_QUALIFIERS.has(qualifier));
}

function isRetailOrderCreationClaim(claim: EvidenceClaim): boolean {
  return claim.field === 'event_type'
    && typeof claim.value === 'string'
    && claim.value.trim().toLowerCase() === 'order_created';
}

/**
 * Applies source-role eligibility without deleting raw evidence from the audit bundle.
 *
 * A direct carrier can legitimately describe its own pickup/transport booking as an
 * "order" or "megrendelés". That language must never be promoted to BuyFlow retail
 * purchase creation merely because the universal event extractor saw order wording.
 * Shipment and delivery evidence from the same carrier source remain fully eligible.
 */
export function evidenceEligibleForResolution(bundle: EvidenceBundle): EvidenceBundle {
  if (!bundle.claims.some(isDirectCarrierSourceClaim)) return bundle;

  return {
    claims: bundle.claims.filter((claim) => !isRetailOrderCreationClaim(claim)),
  };
}
