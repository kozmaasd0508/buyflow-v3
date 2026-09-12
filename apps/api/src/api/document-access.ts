export const DOCUMENT_SIGNED_URL_TTL_SECONDS = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDocumentId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export interface StoredDocumentAccess {
  sourceType: string | null;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string | null;
}

export function isPrivateStoredPdf(document: StoredDocumentAccess): boolean {
  return document.sourceType === 'email_attachment'
    && document.mimeType?.toLowerCase() === 'application/pdf'
    && Boolean(document.storageBucket?.trim())
    && Boolean(document.storagePath?.trim());
}

// The attachment writer uses user UUID / source UUID / SHA-256 prefix.pdf.
// Never sign an arbitrary path just because the document row is user-owned.
export function canSignStoredPdf(document: StoredDocumentAccess, userId: string): boolean {
  if (!isPrivateStoredPdf(document) || !UUID_PATTERN.test(userId)
    || document.storageBucket !== 'buyflow-purchase-documents') return false;
  const parts = document.storagePath?.split('/') ?? [];
  return parts.length === 3
    && parts[0] === userId
    && UUID_PATTERN.test(parts[1] ?? '')
    && /^[a-f0-9]{40}\.pdf$/.test(parts[2] ?? '');
}
