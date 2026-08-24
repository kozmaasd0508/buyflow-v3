import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectCarrierTechnicalEvidenceV1 } from './technical-evidence-carrier-v1.js';
import { collectPdfPaymentTechnicalEvidenceV1 } from './technical-evidence-pdf-payment-v1.js';
import { collectPdfTechnicalEvidenceV1 } from './technical-evidence-pdf-v1.js';
import { collectRegioTechnicalEvidenceV1 } from './technical-evidence-regio-v1.js';
import { collectShopifyTechnicalEvidenceV1 } from './technical-evidence-shopify-v1.js';
import { collectTechnicalEvidenceV12 } from './technical-evidence-v1-2.js';

export const TECHNICAL_EVIDENCE_V15_VERSION = '1.5.0' as const;

export type TechnicalEvidenceV15Kind =
  | 'platform'
  | 'event'
  | 'merchant'
  | 'order_number'
  | 'tracking_number'
  | 'invoice_number'
  | 'payment_reference'
  | 'amount'
  | 'currency'
  | 'carrier'
  | 'payment_method'
  | 'product'
  | 'date'
  | 'raw_signal';

export type TechnicalEvidenceV15Source =
  | 'header'
  | 'authentication'
  | 'structured_data'
  | 'html_title'
  | 'html_attribute'
  | 'alternate_text'
  | 'url'
  | 'carrier_semantic'
  | 'shopify_semantic'
  | 'merchant_semantic'
  | 'pdf';

export interface TechnicalEvidenceV15 {
  kind: TechnicalEvidenceV15Kind;
  rawValue: string;
  normalizedValue?: string;
  namespace?: string;
  source: TechnicalEvidenceV15Source;
  sourcePath: string;
  extractorId: string;
  extractorVersion: string;
  confidence: number;
  qualifiers?: string[];
}

export interface TechnicalEvidencePdfAttachmentV15 {
  filename: string;
  /** Already extracted local PDF text layer. No network/AI work happens here. */
  text: string;
}

export interface TechnicalEvidenceV15Input {
  document: EmailDocumentV1;
  pdfAttachments?: TechnicalEvidencePdfAttachmentV15[];
}

export interface TechnicalEvidenceV15ExtractorRun {
  id: string;
  version: string;
  evidenceCount: number;
}

export interface TechnicalEvidenceShadowV15Result {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V15_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: TechnicalEvidenceV15[];
  ranExtractors: TechnicalEvidenceV15ExtractorRun[];
}

export interface TechnicalEvidenceShadowV15Summary {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V15_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidenceCount: number;
  bySource: Partial<Record<TechnicalEvidenceV15Source, number>>;
  kindsPresent: TechnicalEvidenceV15Kind[];
  identifierKindsPresent: Array<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>;
  namespacesPresent: string[];
  pdfAttachmentsProcessed: number;
}

function assertShadowInvariant(result: { productionWrites: number; aiCalls: number }, source: string): void {
  if (result.productionWrites !== 0 || result.aiCalls !== 0) {
    throw new Error(`technical_evidence_v15_shadow_invariant_failed:${source}`);
  }
}

function asV15(row: {
  kind: string;
  rawValue: string;
  normalizedValue?: string;
  namespace?: string;
  source: string;
  sourcePath: string;
  extractorId: string;
  extractorVersion: string;
  confidence: number;
  qualifiers?: string[];
}): TechnicalEvidenceV15 {
  return {
    kind: row.kind as TechnicalEvidenceV15Kind,
    rawValue: row.rawValue,
    ...(row.normalizedValue !== undefined ? { normalizedValue: row.normalizedValue } : {}),
    ...(row.namespace !== undefined ? { namespace: row.namespace } : {}),
    source: row.source as TechnicalEvidenceV15Source,
    sourcePath: row.sourcePath,
    extractorId: row.extractorId,
    extractorVersion: row.extractorVersion,
    confidence: row.confidence,
    ...(row.qualifiers !== undefined ? { qualifiers: [...row.qualifiers] } : {}),
  };
}

/**
 * Remove only exact duplicate observations. Independent layers are deliberately
 * retained even when they support the same normalized value, because provenance
 * corroboration is part of TechnicalEvidence.
 */
function dedupeEvidence(rows: TechnicalEvidenceV15[]): TechnicalEvidenceV15[] {
  const seen = new Set<string>();
  const output: TechnicalEvidenceV15[] = [];
  for (const row of rows) {
    const key = [
      row.kind,
      row.normalizedValue ?? row.rawValue,
      row.namespace ?? '',
      row.source,
      row.sourcePath,
      row.extractorId,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

/**
 * Executable TechnicalEvidence v1.5 composition.
 *
 * Runs the v1.2 base plus provider-qualified carrier, native Shopify,
 * reviewed merchant-semantic and deterministic PDF evidence layers.
 * It remains observational only: no DB writes, no identity decision, no
 * Purchase creation/linking and no AI call.
 *
 * PDF bytes are intentionally NOT accepted here. The caller may provide only an
 * already locally extracted text layer. Sender domains are always inherited
 * from EmailDocumentV1, so an attachment cannot inject a stronger namespace.
 */
export function collectTechnicalEvidenceV15(input: TechnicalEvidenceV15Input): TechnicalEvidenceShadowV15Result {
  const base = collectTechnicalEvidenceV12(input.document);
  const carrier = collectCarrierTechnicalEvidenceV1(input.document);
  const shopify = collectShopifyTechnicalEvidenceV1(input.document);
  const regio = collectRegioTechnicalEvidenceV1(input.document);
  assertShadowInvariant(base, 'v1.2');
  assertShadowInvariant(carrier, 'carrier');
  assertShadowInvariant(shopify, 'shopify');
  assertShadowInvariant(regio, 'regio-siteengine');

  const rows: TechnicalEvidenceV15[] = [
    ...base.evidence.map(asV15),
    ...carrier.evidence.map(asV15),
    ...shopify.evidence.map(asV15),
    ...regio.evidence.map(asV15),
  ];

  const ranExtractors: TechnicalEvidenceV15ExtractorRun[] = [
    ...base.ranExtractors.map((run) => ({ id: run.id, version: run.version, evidenceCount: run.evidenceCount })),
    { id: 'carrier-semantic-evidence-v1', version: '1.0.0', evidenceCount: carrier.evidence.length },
    { id: 'shopify-semantic-evidence-v1', version: '1.0.0', evidenceCount: shopify.evidence.length },
    { id: 'regio-siteengine-evidence-v1', version: '1.0.0', evidenceCount: regio.evidence.length },
  ];

  const pdfAttachments = (input.pdfAttachments ?? [])
    .filter((attachment) => /\.pdf$/i.test(attachment.filename.trim()) && attachment.text.trim().length > 0);
  const senderDomains = [...input.document.sender.domains];

  let pdfInvoiceCount = 0;
  let pdfPaymentCount = 0;
  for (const attachment of pdfAttachments) {
    const pdfInvoice = collectPdfTechnicalEvidenceV1({
      senderDomains,
      filename: attachment.filename,
      text: attachment.text,
    });
    const pdfPayment = collectPdfPaymentTechnicalEvidenceV1({
      senderDomains,
      filename: attachment.filename,
      text: attachment.text,
    });
    assertShadowInvariant(pdfInvoice, 'pdf-invoice');
    assertShadowInvariant(pdfPayment, 'pdf-payment');
    pdfInvoiceCount += pdfInvoice.evidence.length;
    pdfPaymentCount += pdfPayment.evidence.length;
    rows.push(...pdfInvoice.evidence.map(asV15), ...pdfPayment.evidence.map(asV15));
  }

  ranExtractors.push(
    { id: 'pdf-evidence-v1', version: '1.0.0', evidenceCount: pdfInvoiceCount },
    { id: 'pdf-payment-evidence-v1', version: '1.0.0', evidenceCount: pdfPaymentCount },
  );

  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V15_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: dedupeEvidence(rows),
    ranExtractors,
  };
}

export function summarizeTechnicalEvidenceV15(
  result: TechnicalEvidenceShadowV15Result,
  pdfAttachmentsProcessed = 0,
): TechnicalEvidenceShadowV15Summary {
  const bySource: Partial<Record<TechnicalEvidenceV15Source, number>> = {};
  const kinds = new Set<TechnicalEvidenceV15Kind>();
  const identifiers = new Set<'order_number' | 'tracking_number' | 'invoice_number' | 'payment_reference'>();
  const namespaces = new Set<string>();

  for (const row of result.evidence) {
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    kinds.add(row.kind);
    if (row.namespace) namespaces.add(row.namespace);
    if (row.kind === 'order_number' || row.kind === 'tracking_number' || row.kind === 'invoice_number' || row.kind === 'payment_reference') {
      identifiers.add(row.kind);
    }
  }

  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V15_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidenceCount: result.evidence.length,
    bySource,
    kindsPresent: [...kinds].sort(),
    identifierKindsPresent: [...identifiers].sort(),
    namespacesPresent: [...namespaces].sort(),
    pdfAttachmentsProcessed,
  };
}
