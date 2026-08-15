export interface ParsedInvoiceAttachment {
  documentType: 'invoice';
  invoiceNumber: string;
  orderNumber: string;
  confidence: number;
  parserVersion: 'pdf-invoice-v1';
  reasons: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n');
}

function cleanIdentity(value: string | undefined): string | null {
  const cleaned = (value ?? '').trim().replace(/[),.;:]+$/, '');
  return cleaned.length >= 3 && cleaned.length <= 100 ? cleaned : null;
}

function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /\bbizonylatszam\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
    /\bszamlaszam\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
    /\binvoice\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
  ];
  for (const pattern of patterns) {
    const value = cleanIdentity(text.match(pattern)?.[1]);
    if (value) return value.toUpperCase();
  }
  return null;
}

function extractOrderNumber(text: string): string | null {
  const patterns = [
    /\brendelesszam\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
    /\bmegrendelesszam\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
    /\b(?:rendeles|megrendeles)\s*(?:azonosito|szama)\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
    /\border\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9_./-]{2,99})\b/i,
  ];
  for (const pattern of patterns) {
    const value = cleanIdentity(text.match(pattern)?.[1]);
    if (value) return value.toUpperCase();
  }
  return null;
}

function normalizeOrderForSender(senderDomains: string[], orderNumber: string): { value: string; reasons: string[] } | null {
  const domains = senderDomains.map((domain) => domain.trim().toLowerCase().replace(/^www\./, ''));

  if (domains.includes('jatekbolt.hu')) {
    const match = orderNumber.match(/^JB(\d{6,20})$/i);
    if (!match?.[1]) return null;
    return {
      value: match[1],
      reasons: ['jatekbolt_invoice_order_prefix_normalized'],
    };
  }

  return { value: orderNumber, reasons: [] };
}

export function parseInvoiceAttachmentText(input: {
  senderDomains: string[];
  filename: string;
  text: string;
}): ParsedInvoiceAttachment | null {
  if (!input.text.trim()) return null;
  const normalized = normalizeText(input.text);
  const invoiceNumber = extractInvoiceNumber(normalized);
  const rawOrderNumber = extractOrderNumber(normalized);
  if (!invoiceNumber || !rawOrderNumber) return null;

  const normalizedOrder = normalizeOrderForSender(input.senderDomains, rawOrderNumber);
  if (!normalizedOrder) return null;

  const domains = input.senderDomains.map((domain) => domain.trim().toLowerCase().replace(/^www\./, ''));
  const reasons = [
    'explicit_invoice_number',
    'explicit_order_reference',
    ...normalizedOrder.reasons,
  ];

  let confidence = 0.97;
  if (/\b(?:szamla|invoice)\b/i.test(normalized)) {
    confidence = 0.98;
    reasons.push('explicit_invoice_document_label');
  }

  if (domains.includes('jatekbolt.hu')) {
    if (!/\bmodell\s*&\s*hobby\s+kft\b/i.test(normalized)) return null;
    if (!/\b(?:www\.)?jatekbolt\.hu\b/i.test(normalized)) return null;
    confidence = 0.995;
    reasons.push('verified_jatekbolt_legal_identity', 'verified_jatekbolt_document_domain');
  }

  if (!/\.pdf$/i.test(input.filename.trim())) return null;

  return {
    documentType: 'invoice',
    invoiceNumber,
    orderNumber: normalizedOrder.value,
    confidence,
    parserVersion: 'pdf-invoice-v1',
    reasons,
  };
}
