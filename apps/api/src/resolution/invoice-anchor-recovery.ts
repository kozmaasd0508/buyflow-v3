export type InvoiceAnchorEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'refund'
  | 'return'
  | 'subscription'
  | 'other';

export interface InvoiceAnchorEvidence {
  sourceEmailId: string;
  userId: string;
  emailConnectionId: string;
  senderDomain: string;
  processingStatus: string;
  validationStatus: string | null;
  eventType: InvoiceAnchorEventType | null;
  merchant: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
  paymentStatus: string | null;
  confidence: number;
  receivedAt: string;
}

export interface InvoiceAnchorExistingPurchase {
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export interface InvoiceAnchorRecoveryPlan {
  key: string;
  anchorSourceEmailId: string;
  userId: string;
  emailConnectionId: string;
  senderDomain: string;
  orderNumber: string;
  searchTerm: string;
  windowDays: 90;
  supportSourceEmailIds: string[];
  reasons: string[];
}

const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const MAX_SUPPORT_GAP_DAYS = 14;
const MIN_INVOICE_CONFIDENCE = 0.65;
const MIN_SUPPORT_CONFIDENCE = 0.75;

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function instant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinSupportWindow(a: string, b: string): boolean {
  const left = instant(a);
  const right = instant(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= MAX_SUPPORT_GAP_DAYS * 86_400_000;
}

function groupKey(row: InvoiceAnchorEvidence): string | null {
  const domain = normalizeDomain(row.senderDomain);
  const order = normalizeIdentifier(row.orderNumber);
  if (!row.userId || !domain || order.length < 6 || order.length > 120) return null;
  return `${row.userId}::${domain}::${order}`;
}

function isInvoiceAnchor(row: InvoiceAnchorEvidence): boolean {
  return (
    (row.processingStatus === 'review' || row.processingStatus === 'unlinked') &&
    row.validationStatus === 'validated' &&
    row.eventType === 'invoice_or_receipt' &&
    Boolean(row.merchant?.trim()) &&
    row.confidence >= MIN_INVOICE_CONFIDENCE &&
    Boolean(groupKey(row))
  );
}

function isTrustedLifecycleSupport(row: InvoiceAnchorEvidence): boolean {
  if (!row.validationStatus || !TRUSTED_VALIDATION.has(row.validationStatus)) return false;
  if (row.confidence < MIN_SUPPORT_CONFIDENCE) return false;
  if (row.eventType === 'order_updated' || row.eventType === 'shipment' || row.eventType === 'delivery') {
    return true;
  }
  return row.eventType === 'payment_completed' && row.paymentStatus === 'paid';
}

function existingIdentityKeys(purchases: InvoiceAnchorExistingPurchase[]): Set<string> {
  const keys = new Set<string>();
  for (const purchase of purchases) {
    const domain = normalizeDomain(purchase.merchantDomain);
    const order = normalizeIdentifier(purchase.orderNumber);
    if (purchase.userId && domain && order) keys.add(`${purchase.userId}::${domain}::${order}`);
  }
  return keys;
}

export function resolveInvoiceAnchorRecoveryPlans(
  evidenceRows: InvoiceAnchorEvidence[],
  purchases: InvoiceAnchorExistingPurchase[] = [],
): InvoiceAnchorRecoveryPlan[] {
  const existing = existingIdentityKeys(purchases);
  const groups = new Map<string, InvoiceAnchorEvidence[]>();

  for (const row of evidenceRows) {
    const key = groupKey(row);
    if (!key) continue;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }

  const plans: InvoiceAnchorRecoveryPlan[] = [];

  for (const [key, rows] of groups) {
    if (existing.has(key)) continue;

    const anchors = rows
      .filter(isInvoiceAnchor)
      .sort((a, b) => b.confidence - a.confidence || a.receivedAt.localeCompare(b.receivedAt));
    const anchor = anchors[0];
    if (!anchor?.orderNumber) continue;

    const support = rows.filter((row) =>
      row.sourceEmailId !== anchor.sourceEmailId &&
      isTrustedLifecycleSupport(row) &&
      withinSupportWindow(anchor.receivedAt, row.receivedAt),
    );
    if (support.length === 0) continue;

    const supportEventTypes = new Set(support.map((row) => row.eventType));
    const reasons = ['validated_invoice_has_same_identity_lifecycle_support'];
    if (supportEventTypes.has('shipment')) reasons.push('same_order_merchant_shipment_support');
    if (supportEventTypes.has('delivery')) reasons.push('same_order_merchant_delivery_support');
    if (supportEventTypes.has('order_updated')) reasons.push('same_order_merchant_update_support');
    if (supportEventTypes.has('payment_completed')) reasons.push('same_order_paid_payment_support');

    plans.push({
      key,
      anchorSourceEmailId: anchor.sourceEmailId,
      userId: anchor.userId,
      emailConnectionId: anchor.emailConnectionId,
      senderDomain: normalizeDomain(anchor.senderDomain),
      orderNumber: anchor.orderNumber,
      searchTerm: anchor.orderNumber,
      windowDays: 90,
      supportSourceEmailIds: support.map((row) => row.sourceEmailId),
      reasons,
    });
  }

  return plans.sort((a, b) => a.key.localeCompare(b.key));
}
