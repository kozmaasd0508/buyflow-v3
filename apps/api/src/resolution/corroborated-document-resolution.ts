export interface CorroboratedDocumentSource {
  sourceEmailId: string;
  userId: string;
  providerMessageId: string | null;
  receivedAt: string;
  validationStatus: string | null;
  eventType: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
  confidence: number;
}

export interface CorroboratedDocumentLink {
  purchaseId: string;
  sourceEmailId: string;
  relationType: string | null;
  confidence: number | null;
}

export interface CorroboratedDocumentPurchase {
  purchaseId: string;
  userId: string;
  orderNumber: string | null;
}

export interface CorroboratedExistingDocument {
  purchaseId: string;
  providerMessageId: string | null;
  type: string;
  documentNumber: string | null;
}

export interface CorroboratedDocumentCandidate {
  sourceEmailId: string;
  userId: string;
  purchaseId: string;
  providerMessageId: string;
  documentType: 'invoice';
  documentNumber: string;
  issuedAt: string;
  confidence: number;
}

const LIFECYCLE_RELATIONS = new Set(['order_created', 'order_updated', 'shipment', 'delivery']);

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeDocumentNumber(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function hasIndependentLifecycleSupport(
  purchaseId: string,
  invoiceSourceId: string,
  links: CorroboratedDocumentLink[],
  sourceById: Map<string, CorroboratedDocumentSource>,
): boolean {
  return links.some((link) => {
    if (link.purchaseId !== purchaseId || link.sourceEmailId === invoiceSourceId) return false;
    if (!link.relationType || !LIFECYCLE_RELATIONS.has(link.relationType)) return false;
    if ((link.confidence ?? 0) < 0.70) return false;
    const source = sourceById.get(link.sourceEmailId);
    if (!source || (source.validationStatus !== 'validated' && source.validationStatus !== 'guardrailed')) return false;
    return source.eventType === link.relationType;
  });
}

export function resolveCorroboratedDocumentCandidates(
  sources: CorroboratedDocumentSource[],
  links: CorroboratedDocumentLink[],
  purchases: CorroboratedDocumentPurchase[],
  documents: CorroboratedExistingDocument[] = [],
): CorroboratedDocumentCandidate[] {
  const purchaseById = new Map(purchases.map((row) => [row.purchaseId, row]));
  const sourceById = new Map(sources.map((row) => [row.sourceEmailId, row]));
  const candidates: CorroboratedDocumentCandidate[] = [];

  for (const link of links) {
    if (link.relationType !== 'invoice_or_receipt' && link.relationType !== 'document') continue;
    const source = sourceById.get(link.sourceEmailId);
    const purchase = purchaseById.get(link.purchaseId);
    if (!source || !purchase) continue;
    if (source.userId !== purchase.userId) continue;
    if (source.validationStatus !== 'validated') continue;
    if (source.eventType !== 'invoice_or_receipt') continue;
    if (source.confidence < 0.65 || source.confidence >= 0.85) continue;
    if ((link.confidence ?? 0) < 0.65) continue;
    if (!source.providerMessageId?.trim()) continue;
    if (!source.invoiceNumber?.trim()) continue;

    const sourceOrder = normalizeIdentifier(source.orderNumber);
    const purchaseOrder = normalizeIdentifier(purchase.orderNumber);
    if (sourceOrder.length < 6 || sourceOrder !== purchaseOrder) continue;
    if (!hasIndependentLifecycleSupport(purchase.purchaseId, source.sourceEmailId, links, sourceById)) continue;

    const invoiceNumber = source.invoiceNumber.trim();
    const duplicate = documents.some((document) =>
      document.purchaseId === purchase.purchaseId &&
      document.type === 'invoice' &&
      (
        (document.providerMessageId && document.providerMessageId === source.providerMessageId) ||
        (document.documentNumber && normalizeDocumentNumber(document.documentNumber) === normalizeDocumentNumber(invoiceNumber))
      ),
    );
    if (duplicate) continue;

    candidates.push({
      sourceEmailId: source.sourceEmailId,
      userId: source.userId,
      purchaseId: purchase.purchaseId,
      providerMessageId: source.providerMessageId,
      documentType: 'invoice',
      documentNumber: invoiceNumber,
      issuedAt: source.receivedAt,
      confidence: source.confidence,
    });
  }

  return candidates.sort((a, b) => a.sourceEmailId.localeCompare(b.sourceEmailId));
}
