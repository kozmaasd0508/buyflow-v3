import type { ShipmentProgressSummary } from './deterministic-lifecycle-state.js';

export type ControlledShipmentStatus = 'in_transit' | 'ready_for_pickup' | 'delivered';
export type ControlledShipmentInputStatus = ControlledShipmentStatus | 'shipment_created';

export function monotonicControlledShipmentStatus(
  existing: string | null,
  incoming: ControlledShipmentInputStatus,
): ControlledShipmentStatus {
  if (incoming === 'shipment_created') {
    throw new Error('Controlled shipment verification rejects pre-advice without physical progress');
  }
  if (existing === 'delivered' || incoming === 'delivered') return 'delivered';
  if (existing === 'ready_for_pickup' || incoming === 'ready_for_pickup') return 'ready_for_pickup';
  return 'in_transit';
}

export function purchaseStateMatchesShipmentSummary(
  currentState: string | null | undefined,
  summary: ShipmentProgressSummary,
): boolean {
  if (summary.status) return currentState === summary.status;
  return currentState !== 'delivered' && currentState !== 'ready_for_pickup';
}
