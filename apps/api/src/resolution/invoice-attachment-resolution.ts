export interface InvoiceAttachmentPurchaseIdentity {
  purchaseId: string;
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export type InvoiceAttachmentResolutionDecision = 'linkable' | 'unmatched' | 'review';

export interface InvoiceAttachmentResolution {
  decision: InvoiceAttachmentResolutionDecision;
  purchaseId: string | null;
  reasons: string[];
}

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeOrder(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function resolveInvoiceAttachmentPurchase(input: {
  userId: string;
  senderDomain: string;
  orderNumber: string;
  purchases: InvoiceAttachmentPurchaseIdentity[];
}): InvoiceAttachmentResolution {
  const senderDomain = normalizeDomain(input.senderDomain);
  const orderNumber = normalizeOrder(input.orderNumber);
  if (!senderDomain || !orderNumber) {
    return { decision: 'unmatched', purchaseId: null, reasons: ['missing_invoice_identity'] };
  }

  const matches = input.purchases.filter((purchase) =>
    purchase.userId === input.userId
    && normalizeDomain(purchase.merchantDomain) === senderDomain
    && normalizeOrder(purchase.orderNumber) === orderNumber,
  );

  if (matches.length === 0) {
    return { decision: 'unmatched', purchaseId: null, reasons: ['no_purchase_identity_match'] };
  }

  if (matches.length > 1) {
    return { decision: 'review', purchaseId: null, reasons: ['ambiguous_purchase_identity'] };
  }

  return {
    decision: 'linkable',
    purchaseId: matches[0]!.purchaseId,
    reasons: ['exact_user_merchant_order_identity'],
  };
}
