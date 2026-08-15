import type { EmailExtraction, ProductExtraction } from '../ai/openai-email-extractor.js';

const PARSER_VERSION = 'allegro-order-v1.2';
const ALLEGRO_SENDER_DOMAINS = new Set(['allegro.com', 'allegro.hu', 'allegro.pl', 'allegro.cz', 'allegro.sk']);
const ORDER_UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

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

function extractOrderNumber(body: string): string | null {
  const normalized = normalizeText(body);
  const labelled = normalized.match(new RegExp(`\\bmegrendeles\\s+szama\\s*(${ORDER_UUID_PATTERN})\\b`, 'i'));
  if (labelled?.[1]) return labelled[1].toLowerCase();

  const urlAnchor = body.match(new RegExp(`\\/vasarlasok\\/vasarlasi-elozmenyek\\/(${ORDER_UUID_PATTERN})(?:[?/#\\s]|$)`, 'i'));
  return urlAnchor?.[1]?.toLowerCase() ?? null;
}

function extractSeller(subject: string, body: string): string | null {
  const patterns = [
    /megv(?:á|a)s(?:á|a)roltad\s+\d+\s+term(?:é|e)ket\s+(.{2,120}?)\s+elad(?:ó|o)t(?:ó|o)l/i,
    /megv(?:á|a)s(?:á|a)roltad\s*:\s*.+?\s+(.{2,120}?)\s+elad(?:ó|o)t(?:ó|o)l\.?$/i,
  ];
  for (const source of [body, subject]) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const candidate = match?.[1]?.trim();
      if (candidate && !/^allegro$/i.test(candidate)) return candidate;
    }
  }

  const sellerLine = body.match(/(?:^|\n)\s*t(?:ő|o)le\s*:\s*([^\n]{2,240})/i);
  if (!sellerLine?.[1]) return null;
  const cleaned = sellerLine[1].replace(/\s*\[URL:\s*https?:\/\/[^\]]+\]\s*$/i, '').trim();
  return cleaned && !/^allegro$/i.test(cleaned) ? cleaned : null;
}

function offerIdentity(url: string): { canonicalUrl: string; sku: string | null; name: string } | null {
  try {
    const parsed = new URL(url);
    const marker = '/ajanlat/';
    const markerIndex = parsed.pathname.toLowerCase().indexOf(marker);
    if (markerIndex < 0) return null;
    const slug = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)).replace(/^\/+|\/+$/g, '');
    if (!slug) return null;
    const skuMatch = slug.match(/-(\d{6,20})$/);
    const sku = skuMatch?.[1] ?? null;
    const nameSlug = sku ? slug.slice(0, -(sku.length + 1)) : slug;
    const name = nameSlug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    return {
      canonicalUrl: `${parsed.origin}${parsed.pathname}`,
      sku,
      name,
    };
  } catch {
    return null;
  }
}

function extractProducts(body: string, fallbackCurrency: string): ProductExtraction[] {
  const products: ProductExtraction[] = [];
  const urlPattern = /(?:\[URL:\s*|\]\()(https?:\/\/[^\]\s)]+\/ajanlat\/[^\]\s)]+)/gi;
  const matches = [...body.matchAll(urlPattern)];

  for (const match of matches) {
    const rawUrl = match[1];
    if (!rawUrl) continue;
    const identity = offerIdentity(rawUrl);
    if (!identity) continue;
    if (products.some((existing) => existing.product_url === identity.canonicalUrl)) continue;

    const start = match.index ?? 0;
    const tail = body.slice(start + match[0].length, start + match[0].length + 700);
    const priceMatch = tail.match(/([0-9][0-9 .,'’]{0,20})\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)\b/i);
    if (!priceMatch?.[1] || !priceMatch[2]) continue;
    const amount = money(priceMatch[1]);
    const itemCurrency = currency(priceMatch[2]) ?? fallbackCurrency;
    if (amount === null) continue;

    products.push({
      name: identity.name,
      brand: null,
      model: null,
      variant: null,
      sku: identity.sku,
      gtin: null,
      category: null,
      quantity: 1,
      unit_price: amount,
      total_price: amount,
      currency: itemCurrency,
      product_url: identity.canonicalUrl,
      image_url: null,
      confidence: 0.98,
    });
  }

  return products.slice(0, 50);
}

function extractLabeledTotal(body: string): { amount: number; currency: string } | null {
  const match = normalizeText(body).match(/\bOSSZESEN\b\s*([0-9][0-9 .,'’]{0,20})\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)\b/i);
  if (!match?.[1] || !match[2]) return null;
  const amount = money(match[1]);
  const totalCurrency = currency(match[2]);
  return amount !== null && totalCurrency ? { amount, currency: totalCurrency } : null;
}

function extractPaymentMethod(body: string): string | null {
  const normalized = normalizeText(body);
  const label = normalized.match(/\bfizetesi mod\b/i);
  if (!label || label.index === undefined) return null;
  const window = normalized.slice(label.index + label[0].length, label.index + label[0].length + 180).toLowerCase();
  const methods: Array<[RegExp, string]> = [
    [/\butanvet\b/, 'utánvét'],
    [/\bbankkartya\b/, 'bankkártya'],
    [/\bpaypal\b/, 'PayPal'],
    [/\bgoogle pay\b/, 'Google Pay'],
    [/\bapple pay\b/, 'Apple Pay'],
    [/\bpayu\b/, 'PayU'],
    [/\bblik\b/, 'BLIK'],
    [/\bbanki atutalas\b/, 'banki átutalás'],
  ];
  for (const [pattern, value] of methods) {
    if (pattern.test(window)) return value;
  }
  return null;
}

function extractShipping(body: string): { method: string | null; amount: number | null; carrier: string | null } {
  const normalized = normalizeText(body);
  const carrier = /\bDPD\b/i.test(normalized) ? 'DPD'
    : /\bGLS\b/i.test(normalized) ? 'GLS'
      : /\bPACKETA\b/i.test(normalized) ? 'Packeta'
        : null;

  const shippingMatch = normalized.match(/\bFutar\b([\s\S]{0,260}?)([0-9][0-9 .,'’]{0,20})\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)\b/i);
  const shippingAmount = shippingMatch?.[2] ? money(shippingMatch[2]) : null;
  const cod = /\bFutar\s+utanvet\b/i.test(normalized);
  const method = carrier ? `Futár${cod ? ' utánvét' : ''}, ${carrier}` : (cod ? 'Futár utánvét' : null);
  return { method, amount: shippingAmount, carrier };
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

  if (!/^megvasaroltad\s*:/i.test(normalizedSubject.trim())) return null;
  if (!/\bmegvasaroltad\s+\d+\s+termeket\b/i.test(normalizedBody)) return null;

  const orderNumber = extractOrderNumber(body);
  if (!orderNumber) return null;

  const merchant = extractSeller(subject, body);
  if (!merchant) return null;

  const total = extractLabeledTotal(body);
  if (!total) return null;

  const paymentMethod = extractPaymentMethod(body);
  if (!paymentMethod) return null;

  const products = extractProducts(body, total.currency);
  if (products.length === 0) return null;

  const shipping = extractShipping(body);
  const cod = normalizeText(paymentMethod).toLowerCase() === 'utanvet';

  return {
    extraction: {
      event_type: 'order_created',
      merchant,
      merchant_legal_name: null,
      order_number: orderNumber,
      subtotal: null,
      shipping_amount: shipping.amount,
      discount_amount: null,
      total: total.amount,
      currency: total.currency,
      payment_status: cod ? 'cash_on_delivery' : 'pending',
      payment_method: paymentMethod,
      paid_amount: null,
      paid_currency: null,
      shipping_method: shipping.method,
      tracking_number: null,
      carrier: shipping.carrier,
      parcel_sender: null,
      cod_amount: cod ? total.amount : null,
      cod_currency: cod ? total.currency : null,
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
      'structured_product_offer_urls',
    ],
  };
}
