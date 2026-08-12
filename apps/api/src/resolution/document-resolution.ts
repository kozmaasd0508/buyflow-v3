export type DocumentEventType = 'invoice_or_receipt';

export interface DocumentPurchaseIdentity {
  purchaseId: string;
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export interface DocumentResolutionEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  eventType: DocumentEventType;
  orderNumber: string | null;
  invoiceNumber: string | null;
  confidence: number;
  receivedAt: string;
}

export type DocumentResolutionDecision = 'linkable' | 'unmatched' | 'review';

export interface DocumentResolutionCandidate {
  sourceEmailId: string;
  userId: string;
  purchaseId: string | null;
  decision: DocumentResolutionDecision;
  documentType: 'invoice' | 'receipt';
  confidence: number;
  reasons: string[];
}

function normalizeDomain(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeOrderNumber(value: string | null): string {
  return (value ?? '').replace(/\s+/g, '').trim().toUpperCase();
}

export function resolveDocumentCandidates(
  purchases: DocumentPurchaseIdentity[],
  evidence: DocumentResolutionEvidence[],
): DocumentResolutionCandidate[] {
  return evidence.map((row) => {
    const documentType = row.invoiceNumber ? 'invoice' : 'receipt';
    const reasons: string[] = [];

    if (!row.orderNumber) {
      return {
        sourceEmailId: row.sourceEmailId,
        userId: row.userId,
        purchaseId: null,
        decision: 'unmatched',
        documentType,
        confidence: row.confidence,
        reasons: ['missing_order_number'],
      };
    }

    const senderDomain = normalizeDomain(row.senderDomain);
    const orderNumber = normalizeOrderNumber(row.orderNumber);

    const matches = purchases.filter(
      (purchase) =>
        purchase.userId === row.userId &&
        normalizeDomain(purchase.merchantDomain) === senderDomain &&
        normalizeOrderNumber(purchase.orderNumber) === orderNumber,
    );

    if (matches.length === 0) {
      return {
        sourceEmailId: row.sourceEmailId,
        userId: row.userId,
        purchaseId: null,
        decision: 'unmatched',
        documentType,
        confidence: row.confidence,
        reasons: ['no_purchase_identity_match'],
      };
    }

    if (matches.length > 1) {
      return {
        sourceEmailId: row.sourceEmailId,
        userId: row.userId,
        purchaseId: null,
        decision: 'review',
        documentType,
        confidence: row.confidence,
        reasons: ['ambiguous_purchase_identity'],
      };
    }

    if (row.confidence < 0.85) {
      return {
        sourceEmailId: row.sourceEmailId,
        userId: row.userId,
        purchaseId: matches[0]!.purchaseId,
        decision: 'review',
        documentType,
        confidence: row.confidence,
        reasons: ['low_document_confidence'],
      };
    }

    if (documentType === 'invoice' && !row.invoiceNumber) {
      reasons.push('invoice_number_missing');
    }

    return {
      sourceEmailId: row.sourceEmailId,
      userId: row.userId,
      purchaseId: matches[0]!.purchaseId,
      decision: 'linkable',
      documentType,
      confidence: row.confidence,
      reasons,
    };
  });
}
