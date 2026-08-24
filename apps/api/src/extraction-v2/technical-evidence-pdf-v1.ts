import { parseInvoiceAttachmentText } from '../ingestion/invoice-attachment-parser.js';

export type PdfTechnicalEvidenceKind =
  | 'event'
  | 'order_number'
  | 'invoice_number';

export interface PdfTechnicalEvidenceV1 {
  kind: PdfTechnicalEvidenceKind;
  rawValue: string;
  normalizedValue: string;
  namespace?: string;
  source: 'pdf';
  sourcePath: string;
  extractorId: 'pdf-evidence-v1';
  extractorVersion: '1.0.0';
  confidence: number;
  qualifiers: string[];
}

export interface PdfTechnicalEvidenceV1Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: PdfTechnicalEvidenceV1[];
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '');
}

function invoiceNamespace(senderDomains: string[]): string | undefined {
  const domains = senderDomains.map(normalizeDomain);
  if (domains.includes('jatekbolt.hu')) return 'JATEKBOLT';
  return domains[0] ? `MERCHANT:${domains[0]}` : undefined;
}

/**
 * Pure PDF TechnicalEvidence shadow adapter.
 *
 * The PDF bytes/text extraction itself remains in the existing deterministic
 * attachment stack (`pdf-text-extractor.ts`). This function only converts an
 * already extracted PDF text layer into provenance-preserving evidence.
 *
 * It performs no writes, no network calls and no AI calls.
 */
export function collectPdfTechnicalEvidenceV1(input: {
  senderDomains: string[];
  filename: string;
  text: string;
}): PdfTechnicalEvidenceV1Result {
  const parsed = parseInvoiceAttachmentText(input);
  if (!parsed) {
    return {
      schemaVersion: 1,
      mode: 'shadow',
      productionWrites: 0,
      aiCalls: 0,
      evidence: [],
    };
  }

  const namespace = invoiceNamespace(input.senderDomains);
  const baseQualifiers = ['pdf_text_layer', ...parsed.reasons];

  const evidence: PdfTechnicalEvidenceV1[] = [
    {
      kind: 'event',
      rawValue: 'invoice',
      normalizedValue: 'invoice_or_receipt',
      source: 'pdf',
      sourcePath: 'pdf.documentType',
      extractorId: 'pdf-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: parsed.confidence,
      qualifiers: [...baseQualifiers, parsed.parserVersion],
    },
    {
      kind: 'invoice_number',
      rawValue: parsed.invoiceNumber,
      normalizedValue: parsed.invoiceNumber,
      ...(namespace ? { namespace } : {}),
      source: 'pdf',
      sourcePath: 'pdf.invoiceNumber',
      extractorId: 'pdf-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: parsed.confidence,
      qualifiers: [...baseQualifiers, parsed.parserVersion],
    },
    {
      kind: 'order_number',
      rawValue: parsed.orderNumber,
      normalizedValue: parsed.orderNumber,
      ...(namespace ? { namespace } : {}),
      source: 'pdf',
      sourcePath: 'pdf.orderNumber',
      extractorId: 'pdf-evidence-v1',
      extractorVersion: '1.0.0',
      confidence: parsed.confidence,
      qualifiers: [...baseQualifiers, parsed.parserVersion],
    },
  ];

  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence,
  };
}
