import type { EmailExtraction } from '../ai/openai-email-extractor.js';

const PARSER_VERSION = 'deterministic-lifecycle-v1';

type AlzaLifecycleEvent = 'payment_failed' | 'cancelled' | 'delayed';

export interface AlzaLifecycleParseResult {
  extraction: EmailExtraction;
  lifecycleEvent: AlzaLifecycleEvent;
  parserVersion: string;
  reasons: string[];
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

function domainMatches(domain: string, expected: string): boolean {
  const normalized = normalizeDomain(domain);
  const target = normalizeDomain(expected);
  return normalized === target || normalized.endsWith(`.${target}`);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function extractOrderNumber(context: string): string | null {
  const labelled = context.match(/\bmegrendeles\s+(\d{9,12})\b/i);
  if (labelled?.[1]) return labelled[1];

  const subjectStyle = context.match(
    /\b(\d{9,12})\s+sz\.?\s+megr(?:\.|endeles(?:ed|rol|e|t|enek|edet)?)\b/i,
  );
  return subjectStyle?.[1] ?? null;
}

function extraction(input: {
  orderNumber: string;
  paymentStatus?: EmailExtraction['payment_status'];
}): EmailExtraction {
  return {
    event_type: 'order_updated',
    merchant: 'Alza.hu',
    merchant_legal_name: null,
    order_number: input.orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: input.paymentStatus ?? null,
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

export function parseAlzaLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AlzaLifecycleParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'alza.hu'))) {
    return null;
  }

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;
  const orderNumber = extractOrderNumber(context);
  if (!orderNumber) return null;

  const paymentFailed = [
    /\bbank elutasitotta a reszletfizetest\b/i,
    /\bfizetes(?:e|ed)? sikertelen\b/i,
    /\bfizetes(?:e|ed)? nem sikerult\b/i,
  ].some((pattern) => pattern.test(context));

  if (paymentFailed) {
    return {
      extraction: extraction({ orderNumber, paymentStatus: 'failed' }),
      lifecycleEvent: 'payment_failed',
      parserVersion: PARSER_VERSION,
      reasons: ['known_alza_sender', 'explicit_payment_failure', 'explicit_order_number'],
    };
  }

  const cancelled = [
    /\ba megrendeles torolve\b/i,
    /\btorolt megrendeles\b/i,
    /\bmegrendeles(?:ed|et)? toroltuk\b/i,
    /\bmegrendeles torlese\b/i,
  ].some((pattern) => pattern.test(context));

  if (cancelled) {
    return {
      extraction: extraction({ orderNumber }),
      lifecycleEvent: 'cancelled',
      parserVersion: PARSER_VERSION,
      reasons: ['known_alza_sender', 'explicit_order_cancellation', 'explicit_order_number'],
    };
  }

  const delayed = [
    /\bmegrendeles(?:ed)? kesve erkezik\b/i,
    /\belnezest kerunk a kesesert\b/i,
    /\bkezbesites varhato uj idopontja\b/i,
  ].some((pattern) => pattern.test(context));

  if (delayed) {
    return {
      extraction: extraction({ orderNumber }),
      lifecycleEvent: 'delayed',
      parserVersion: PARSER_VERSION,
      reasons: ['known_alza_sender', 'explicit_order_delay', 'explicit_order_number'],
    };
  }

  return null;
}
