import type { EmailExtraction } from '../ai/openai-email-extractor.js';

const PARSER_VERSION = 'allegro-sales-document-v1';
const ALLEGRO_RELAY_DOMAIN = 'allegromail.com';

export interface AllegroSalesDocumentParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '');
}

function exactRelaySender(domains: string[]): boolean {
  return domains.some((domain) => domain.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '') === ALLEGRO_RELAY_DOMAIN);
}

function baseExtraction(orderNumber: string): EmailExtraction {
  return {
    event_type: 'invoice_or_receipt',
    merchant: null,
    merchant_legal_name: null,
    order_number: orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
  };
}

export function parseAllegroSalesDocumentEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AllegroSalesDocumentParseResult | null {
  if (!exactRelaySender(input.senderDomains)) return null;

  const subject = normalizeText(input.subject ?? '').trim();
  const body = input.bodyText ?? '';
  const normalizedBody = normalizeText(body);

  const subjectMatch = subject.match(/^megrendelesre szant ertekesitesi dokumentum\s+(\d{5,20})\s*\(dokument sprzedazy do zamowienia\s+(\d{5,20})\)$/i);
  if (!subjectMatch?.[1] || !subjectMatch[2] || subjectMatch[1] !== subjectMatch[2]) return null;
  const orderNumber = subjectMatch[1];

  const mentionsHungarianDocument = normalizedBody.toLowerCase().includes(`a ${orderNumber}-es rendeleshez szukseges ertekesitesi dokumentumot`);
  const mentionsPolishDocument = normalizedBody.toLowerCase().includes(`dokument sprzedazy za zamowienie ${orderNumber}`);
  const invoiceUrl = `https://orders-f.baselinker.com/${orderNumber}/`;
  const hasInvoiceUrl = body.toLowerCase().includes(invoiceUrl.toLowerCase()) && /\/invoice(?:\b|\?|$)/i.test(body);
  if (!(mentionsHungarianDocument || mentionsPolishDocument) || !hasInvoiceUrl) return null;

  return {
    extraction: baseExtraction(orderNumber),
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_allegro_relay_sender',
      'explicit_bilingual_sales_document_subject',
      'matching_sales_document_order_number',
      'explicit_baselinker_invoice_url',
      'document_identity_overrides_delivery_wording',
    ],
  };
}
