import type { PurchaseIdentitySnapshot } from './types.js';

const PURCHASE_LIMIT = 500;
const SHIPMENT_LIMIT = 1000;
const DOCUMENT_LIMIT = 1000;

export interface LegacySnapshotLoadResult {
  snapshot: PurchaseIdentitySnapshot;
  complete: boolean;
  counts: {
    purchases: number;
    orders: number;
    shipments: number;
    invoices: number;
  };
}

function state(value: unknown): PurchaseIdentitySnapshot['purchases'][number]['state'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'fulfilled' || normalized === 'delivered') return 'fulfilled';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'returned') return 'returned';
  if (normalized === 'refunded') return 'refunded';
  if (normalized === 'open' || normalized === 'ordered' || normalized === 'processing' || normalized === 'shipped') return 'open';
  return 'unknown';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Read-only compatibility snapshot for Purchase Identity Graph v2 shadow runs.
 * Every query is explicitly scoped to one user. Legacy merchant domains are NOT
 * promoted into canonical merchant ids; that requires the separate merchant
 * identity registry. Carrier slugs are retained because they already represent
 * the shipment's carrier namespace in the legacy schema.
 */
export async function loadLegacyPurchaseIdentitySnapshot(input: {
  db: any;
  userId: string;
}): Promise<LegacySnapshotLoadResult> {
  const { db, userId } = input;
  const { data: purchaseRows, error: purchaseError } = await db
    .from('purchases')
    .select('id,user_id,order_number,current_state')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(PURCHASE_LIMIT);
  if (purchaseError) throw new Error(`Failed to load Purchase Identity shadow purchases: ${purchaseError.message}`);

  const purchases = (purchaseRows ?? []).map((row: any) => ({
    purchaseId: String(row.id),
    userId,
    canonicalMerchantId: null,
    primaryOrderIdentityId: stringOrNull(row.order_number) ? `legacy-order:${String(row.id)}` : null,
    state: state(row.current_state),
  }));

  const orders = (purchaseRows ?? []).flatMap((row: any) => {
    const orderId = stringOrNull(row.order_number);
    if (!orderId) return [];
    return [{
      orderIdentityId: `legacy-order:${String(row.id)}`,
      purchaseId: String(row.id),
      merchantId: null,
      orderId,
      relation: 'primary' as const,
      parentOrderIdentityId: null,
    }];
  });

  const purchaseIds = purchases.map((purchase) => purchase.purchaseId);
  let shipmentRows: any[] = [];
  let documentRows: any[] = [];

  if (purchaseIds.length > 0) {
    const shipmentResult = await db
      .from('shipments')
      .select('id,user_id,purchase_id,carrier_slug,tracking_number,status')
      .eq('user_id', userId)
      .in('purchase_id', purchaseIds)
      .limit(SHIPMENT_LIMIT);
    if (shipmentResult.error) throw new Error(`Failed to load Purchase Identity shadow shipments: ${shipmentResult.error.message}`);
    shipmentRows = shipmentResult.data ?? [];

    const documentResult = await db
      .from('documents')
      .select('id,user_id,purchase_id,type,document_number')
      .eq('user_id', userId)
      .in('purchase_id', purchaseIds)
      .limit(DOCUMENT_LIMIT);
    if (documentResult.error) throw new Error(`Failed to load Purchase Identity shadow documents: ${documentResult.error.message}`);
    documentRows = documentResult.data ?? [];
  }

  const shipments = shipmentRows.flatMap((row: any) => {
    const purchaseId = stringOrNull(row.purchase_id);
    if (!purchaseId || !purchaseIds.includes(purchaseId)) return [];
    return [{
      shipmentId: String(row.id),
      purchaseId,
      carrierId: stringOrNull(row.carrier_slug),
      trackingId: stringOrNull(row.tracking_number),
      status: stringOrNull(row.status),
    }];
  });

  const invoices = documentRows.flatMap((row: any) => {
    const purchaseId = stringOrNull(row.purchase_id);
    const documentNumber = stringOrNull(row.document_number);
    const type = stringOrNull(row.type)?.toLowerCase();
    if (!purchaseId || !purchaseIds.includes(purchaseId) || !documentNumber || type !== 'invoice') return [];
    return [{
      invoiceIdentityId: `legacy-document:${String(row.id)}`,
      purchaseId,
      issuerId: null,
      invoiceId: documentNumber,
      orderId: null,
    }];
  });

  return {
    snapshot: {
      purchases,
      orders,
      shipments,
      payments: [],
      invoices,
    },
    complete:
      (purchaseRows ?? []).length < PURCHASE_LIMIT
      && shipmentRows.length < SHIPMENT_LIMIT
      && documentRows.length < DOCUMENT_LIMIT,
    counts: {
      purchases: purchases.length,
      orders: orders.length,
      shipments: shipments.length,
      invoices: invoices.length,
    },
  };
}
