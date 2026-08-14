import type { EmailExtraction, ProductExtraction } from '../ai/openai-email-extractor.js';

const PARSER_VERSION = 'allegro-order-v1.1';
const ALLEGRO_SENDER_DOMAINS = new Set(['allegro.com', 'allegro.hu', 'allegro.pl', 'allegro.cz', 'allegro.sk']);

export interface AllegroOrderParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
}

function money(raw: string): number | null {
  let value = raw.trim().replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (!value) return null;
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  else if (comma >= 0) value = value.length - comma - 1 === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currency(token: string): string | null {
  const value = token.trim().toUpperCase();
  if (value === 'FT' || value === 'HUF') return 'HUF';
  if (value === 'EUR' || value === '€') return 'EUR';
  if (value === 'USD' || value === '$') return 'USD';
  if (value === 'GBP' || value === '£') return 'GBP';
  return null;
}

function cleanSeller(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s*\[URL:\s*https?:\/\/[^\]]+\]\s*$/i, '').trim();
  return cleaned || null;
}

function productFromMatch(match: RegExpMatchArray, fallbackCurrency: string): ProductExtraction | null {
  const name = match[1]?.trim();
  const productUrl = match[2]?.trim();
  const sku = match[3]?.trim() ?? null;
  const amount = money(match[4] ?? '');
  const itemCurrency = currency(match[5] ?? '') ?? fallbackCurrency;
  if (!name || !productUrl || amount === null) return null;
  return {
    name,
    brand: null,
    model: null,
    variant: null,
    sku,
    gtin: null,
    category: null,
    quantity: 1,
    unit_price: amount,
    total_price: amount,
    currency: itemCurrency,
    product_url: productUrl,
    image_url: null,
    confidence: 0.98,
  };
}

function extractProducts(body: string, fallbackCurrency: string): ProductExtraction[] {
  const products: ProductExtraction[] = [];
  const patterns = [
    /\[([^\]\n]{3,240})\]\((https?:\/\/[^)\n]*\/ajanlat\/[^)\n]+)\)\s*\n(?:\[\((\d{6,20})\)\]\([^)\n]+\)\s*\n)?\s*([0-9][0-9 .,'’]*)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)/gi,
    /(?:^|\n)\s*([^\n]{3,240}?)\s+\[URL:\s*(https?:\/\/[^\]\n]*\/ajanlat\/[^\]\n]+)\]\s*\n(?:\s*\(?([0-9]{6,20})\)?\s+\[URL:\s*https?:\/\/[^\]\n]+\]\s*\n)?\s*([0-9][0-9 .,'’]*)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const product = productFromMatch(match, fallbackCurrency);
      if (!product) continue;
      if (products.some((existing) => existing.product_url === product.product_url)) continue;
      products.push(product);
    }
  }
  return products.slice(0, 50);
}

export function parseAllegroOrderEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): AllegroOrderParseResult | null {
  const domains = input.senderDomains.map(normalizeDomain);
  if (!domains.some((domain) => ALLEGRO_SENDER_DOMAINS.has(domain))) return null;

  const subject = input.subject ?? '';
  const body = input.bodyText ?? '';
  const normalizedSubject = normalizeText(subject);
  const normalizedBody = normalizeText(body);

  if (!/^megv(?:a|á)s(?:a|á)roltad\s*:/i.test(subject.trim()) && !/^megvasaroltad\s*:/i.test(normalizedSubject.trim())) return null;
  if (!/\bmegvasaroltad\s+\d+\s+termeket\b/i.test(normalizedBody)) return null;

  const orderMatch = normalizedBody.match(/\bmegrendeles\s+szama\s*\n+\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (!orderMatch?.[1]) return null;

  const sellerMatch = body.match(/(?:^|\n)\s*t(?:ő|o)le\s*:\s*([^\n]{2,240})/i)
    ?? body.match(/megv(?:á|a)s(?:á|a)roltad\s+\d+\s+term(?:é|e)ket\s+([^\n]{2,120}?)\s+elad(?:ó|o)t(?:ó|o)l/i);
  const merchant = cleanSeller(sellerMatch?.[1]);
  if (!merchant || /^allegro$/i.test(merchant)) return null;

  const totalMatch = body.match(/(?:^|\n)\s*(?:ÖSSZESEN|OSSZESEN)\s*\n+\s*([0-9][0-9 .,'’]*)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)/i);
  if (!totalMatch?.[1] || !totalMatch[2]) return null;
  const total = money(totalMatch[1]);
  const totalCurrency = currency(totalMatch[2]);
  if (total === null || !totalCurrency) return null;

  const paymentMatch = body.match(/(?:^|\n)\s*Fizet(?:é|e)si m(?:ó|o)d\s*\n+\s*([^\n]{2,120})/i);
  const paymentMethod = paymentMatch?.[1]?.trim() ?? null;
  if (!paymentMethod) return null;

  const shippingMatch = body.match(/(?:^|\n)\s*((?:Fut(?:á|a)r|Sz(?:á|a)ll(?:í|i)t(?:á|a)s)[^\n]{2,160})\s*\n+\s*([0-9][0-9 .,'’]*)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)/i);
  const shippingMethod = shippingMatch?.[1]?.trim() ?? null;
  const shippingAmount = shippingMatch?.[2] ? money(shippingMatch[2]) : null;
  const products = extractProducts(body, totalCurrency);
  if (products.length === 0) return null;

  const normalizedPayment = normalizeText(paymentMethod).toLowerCase();
  const cod = /\butanvet\b|\bcash on delivery\b|\bcod\b/.test(normalizedPayment);
  const carrier = /\bDPD\b/i.test(shippingMethod ?? '') ? 'DPD'
    : /\bGLS\b/i.test(shippingMethod ?? '') ? 'GLS'
      : null;

  return {
    extraction: {
      event_type: 'order_created',
      merchant,
      merchant_legal_name: null,
      order_number: orderMatch[1].toLowerCase(),
      subtotal: null,
      shipping_amount: shippingAmount,
      discount_amount: null,
      total,
      currency: totalCurrency,
      payment_status: cod ? 'cash_on_delivery' : 'pending',
      payment_method: paymentMethod,
      paid_amount: null,
      paid_currency: null,
      shipping_method: shippingMethod,
      tracking_number: null,
      carrier,
      parcel_sender: null,
      cod_amount: cod ? total : null,
      cod_currency: cod ? totalCurrency : null,
      invoice_number: null,
      products,
      confidence: 0.995,
    },
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_allegro_sender',
      'explicit_purchased_subject',
      'explicit_marketplace_seller',
      'explicit_uuid_order_number',
      'explicit_total',
      'explicit_payment_method',
      'structured_product_rows',
    ],
  };
}
