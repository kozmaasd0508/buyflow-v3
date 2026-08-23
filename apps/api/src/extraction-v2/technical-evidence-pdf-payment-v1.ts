export type PdfPaymentTechnicalEvidenceKind =
  | 'event'
  | 'tracking_number'
  | 'payment_reference'
  | 'amount'
  | 'currency';

export interface PdfPaymentTechnicalEvidenceV1 {
  kind: PdfPaymentTechnicalEvidenceKind;
  rawValue: string;
  normalizedValue: string;
  namespace?: string;
  source: 'pdf';
  sourcePath: string;
  extractorId: 'pdf-payment-evidence-v1';
  extractorVersion: '1.0.0';
  confidence: number;
  qualifiers: string[];
}

export interface PdfPaymentTechnicalEvidenceV1Result {
  schemaVersion: 1;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: PdfPaymentTechnicalEvidenceV1[];
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '');
}

function money(raw: string): string {
  return raw.replace(/\s+/g, '').replace(',', '.');
}

/**
 * Provider-qualified PDF payment receipt evidence.
 *
 * v1 intentionally supports only the verified GLS parcel-locker COD receipt
 * family. This prevents generic labels such as `REF SZÁM` or `CSOMAGSZÁM`
 * from being harvested from unrelated PDFs.
 */
export function collectPdfPaymentTechnicalEvidenceV1(input: {
  senderDomains: string[];
  filename: string;
  text: string;
}): PdfPaymentTechnicalEvidenceV1Result {
  const empty = (): PdfPaymentTechnicalEvidenceV1Result => ({
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: [],
  });

  const domains = input.senderDomains.map(normalizeDomain);
  if (!domains.includes('gls-hungary.com')) return empty();
  if (!/^paymentReceipt_.+\.pdf$/i.test(input.filename.trim())) return empty();
  if (!/GLS\s+General\s+Logistics\s+Systems/i.test(input.text)) return empty();
  if (!/Hungary\s+Csomag-Logisztikai\s+Kft/i.test(input.text)) return empty();

  const tracking = input.text.match(/\bCSOMAGSZ[AÁ]M\s*:\s*(0?\d{9,14})\b/i)?.[1];
  const transaction = input.text.match(/\bTRANZAKCI[ÓO]S\s+SZ[AÁ]M\s*:\s*([A-Z0-9._/-]{8,80})\b/i)?.[1];
  const amount = input.text.match(/\b(?:ÖSSZEG|OSSZEG)\s*:\s*([0-9][0-9 .\u00a0]*[,.][0-9]{2})\b/i)?.[1];
  if (!tracking || !transaction || !amount) return empty();

  const normalizedTracking = tracking.replace(/^0(?=\d{9,13}$)/, '');
  const normalizedAmount = money(amount);
  const qualifiers = [
    'gls_sender_domain',
    'gls_receipt_filename',
    'verified_gls_legal_identity',
    'explicit_cod_receipt_fields',
  ];

  return {
    schemaVersion: 1,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: [
      {
        kind: 'event',
        rawValue: 'cod_payment_receipt',
        normalizedValue: 'payment_completed',
        source: 'pdf',
        sourcePath: 'pdf.gls.cod_receipt',
        extractorId: 'pdf-payment-evidence-v1',
        extractorVersion: '1.0.0',
        confidence: 0.995,
        qualifiers,
      },
      {
        kind: 'tracking_number',
        rawValue: tracking,
        normalizedValue: normalizedTracking,
        namespace: 'GLS',
        source: 'pdf',
        sourcePath: 'pdf.gls.CSOMAGSZAM',
        extractorId: 'pdf-payment-evidence-v1',
        extractorVersion: '1.0.0',
        confidence: 0.995,
        qualifiers,
      },
      {
        kind: 'payment_reference',
        rawValue: transaction,
        normalizedValue: transaction.toUpperCase(),
        namespace: 'GLS_COD',
        source: 'pdf',
        sourcePath: 'pdf.gls.TRANZAKCIOS_SZAM',
        extractorId: 'pdf-payment-evidence-v1',
        extractorVersion: '1.0.0',
        confidence: 0.995,
        qualifiers,
      },
      {
        kind: 'amount',
        rawValue: amount,
        normalizedValue: normalizedAmount,
        namespace: 'GLS_COD',
        source: 'pdf',
        sourcePath: 'pdf.gls.OSSZEG',
        extractorId: 'pdf-payment-evidence-v1',
        extractorVersion: '1.0.0',
        confidence: 0.99,
        qualifiers,
      },
      {
        kind: 'currency',
        rawValue: 'HUF',
        normalizedValue: 'HUF',
        namespace: 'GLS_COD',
        source: 'pdf',
        sourcePath: 'pdf.gls.currency',
        extractorId: 'pdf-payment-evidence-v1',
        extractorVersion: '1.0.0',
        confidence: 0.99,
        qualifiers,
      },
    ],
  };
}
