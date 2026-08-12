import type { ShipmentResolutionCandidate } from './shipment-resolution.js';

export function selectControlledShipmentCandidate(
  candidates: ShipmentResolutionCandidate[],
): ShipmentResolutionCandidate {
  const linkable = candidates.filter((candidate) => candidate.decision === 'linkable');

  if (linkable.length !== 1) {
    throw new Error(`Expected exactly one linkable shipment candidate, got ${linkable.length}`);
  }

  const candidate = linkable[0]!;

  if (!candidate.purchaseId) {
    throw new Error('Controlled shipment candidate has no purchase');
  }
  if (!candidate.trackingNumber) {
    throw new Error('Controlled shipment candidate has no tracking number');
  }
  if (!candidate.carrierSlug) {
    throw new Error('Controlled shipment candidate has no unambiguous carrier');
  }
  if (candidate.evidenceCount < 3) {
    throw new Error('Controlled shipment candidate has insufficient evidence');
  }
  if (candidate.merchantAnchorCount < 1) {
    throw new Error('Controlled shipment candidate has no trusted merchant anchor');
  }
  if (candidate.carrierEvidenceCount < 2) {
    throw new Error('Controlled shipment candidate has insufficient carrier corroboration');
  }

  return candidate;
}
