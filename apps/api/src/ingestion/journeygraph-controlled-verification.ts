import type { ShipmentProgressSummary } from './deterministic-lifecycle-state.js';

export type ControlledShipmentStatus = 'in_transit' | 'ready_for_pickup' | 'delivered';

export function monotonicControlledShipmentStatus(
  existing: string | null,
  incoming: ControlledShipmentStatus,
): ControlledShipmentStatus {
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
