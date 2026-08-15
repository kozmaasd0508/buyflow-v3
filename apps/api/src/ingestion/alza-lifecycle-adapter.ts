import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender, merchantDisplayName } from '../email/sender-role.js';

const PARSER_VERSION = 'deterministic-lifecycle-v1';
const ALZA_PROCESSING_PARSER_VERSION = 'alza-order-processing-v2';

type AlzaLifecycleEvent = 'payment_failed' | 'cancelled' | 'delayed' | 'order_processing';

export interface AlzaLifecycleParseResult {
  extraction: EmailExtraction;
  lifecycleEvent: AlzaLifecycleEvent;
  parserVersion: string;
  reasons: string[];
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

function parseHuf(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw.replace(/[^0-9]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extraction(input: {
  orderNumber: string;
  paymentStatus?: EmailExtraction['payment_status'];
  merchantLegalName?: string | null;
  total?: number | null;
  currency?: string | null;
  paymentMethod?: string | null;
  shippingMethod?: string | null;
  invoiceNumber?: string | null;
  confidence?: number;
}): EmailExtraction {
  return {
    event_type: 'order_updated',
    merchant: merchantDisplayName('alza'),
    merchant_legal_name: input.merchantLegalName ?? null,
    order_number: input.orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: input.total ?? null,
    currency: input.currency ?? null,
    payment_status: input.paymentStatus ?? null,
    payment_method: input.paymentMethod ?? null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: input.shippingMethod ?? null,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: input.invoiceNumber ?? null,
    products: [],
    confidence: input.confidence ?? 0.99,
  };
}

function parseStrictProcessingEvidence(input: {
  subject: string;
  body: string;
  orderNumber: string;
}): AlzaLifecycleParseResult | null {
  const processing = (
    /\bmar dolgozunk rajta\b/i.test(input.subject) &&
    /\bmegrendelesed feldolgozasat megkezdtuk\b/i.test(input.body)
  ) || /\bmegrendeles(?:ed)? feldolgozasat megkezdtuk\b/i.test(`${input.subject}\n${input.body}`);
  if (!processing) return null;

  const explicitNoContract = /\bmeg nem jott letre szerzodes kozottunk\b/i.test(input.body)
    && /\ba szerzodes letrejotterol tovabbi e-mailben fogunk tajekoztatni\b/i.test(input.body);
  const referenceOrder = input.body.match(/\bhivatkozasi szam\s*:\s*(\d{9,12})\b/i)?.[1] ?? null;
  const amount = parseHuf(input.body.match(/\bosszeg\s*:\s*([0-9][0-9 .]*)\s*HUF\b/i)?.[1]);
  const payableTotal = parseHuf(input.body.match(/\bfizetendo osszesen[^:]{0,40}:\s*([0-9][0-9 .]*)\s*HUF\b/i)?.[1]);
  const invoiceNumber = input.body.match(/\bpdfdoc\.asp\?d=(AHUW\d{6,20})\b/i)?.[1]?.toUpperCase()
    ?? input.body.match(/\b(AHUW\d{6,20})\b/i)?.[1]?.toUpperCase()
    ?? null;
  const alzaBox = /\bszallitas\s*-\s*alzabox\b/i.test(input.body);
  const payAtPickupOrOnline = /\bfizetendo kartyaval atvetelkor\b/i.test(input.body)
    && /\bonline (?:is )?kifizetheted\b/i.test(input.body);
  const legalEntity = /\balza\.hu kft\b/i.test(input.body);

  if (
    !explicitNoContract ||
    !referenceOrder ||
    referenceOrder !== input.orderNumber ||
    amount === null ||
    payableTotal === null ||
    amount !== payableTotal ||
    !invoiceNumber ||
    !alzaBox ||
    !payAtPickupOrOnline ||
    !legalEntity
  ) return null;

  return {
    extraction: extraction({
      orderNumber: input.orderNumber,
      merchantLegalName: 'Alza.hu Kft.',
      total: payableTotal,
      currency: 'HUF',
      paymentStatus: 'pending',
      paymentMethod: 'Kártya átvételkor vagy online',
      shippingMethod: 'AlzaBox',
      invoiceNumber,
      confidence: 0.995,
    }),
    lifecycleEvent: 'order_processing',
    parserVersion: ALZA_PROCESSING_PARSER_VERSION,
    reasons: [
      'known_alza_sender',
      'explicit_order_processing',
      'explicit_order_number',
      'reference_order_matches',
      'explicit_no_contract_yet',
      'duplicate_total_amount_agrees',
      'explicit_alza_invoice_identity',
      'explicit_alzabox_fulfillment',
      'explicit_card_at_pickup_or_online',
      'explicit_alza_legal_entity',
    ],
  };
}

export function parseAlzaLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AlzaLifecycleParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'alza')) return null;

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

  return parseStrictProcessingEvidence({ subject, body, orderNumber });
}
