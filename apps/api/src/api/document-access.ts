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
