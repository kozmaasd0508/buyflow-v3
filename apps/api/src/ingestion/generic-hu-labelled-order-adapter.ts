import type { EmailExtraction, ProductExtraction } from '../ai/openai-email-extractor.js';
import { isCarrierSenderDomain } from '../validation/email-extraction-validator.js';
import { isPublicMailboxSenderDomain, isSharedPlatformSenderDomain } from './generic-order-confirmation-adapter.js';

const PARSER_VERSION = 'generic-hu-labelled-order-v1';

export interface GenericHuLabelledOrderParseResult {
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

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function merchantFromDomain(domain: string): string {
  const labels = normalizeDomain(domain).split('.').filter(Boolean);
  const root = labels.length >= 2 ? labels[labels.length - 2]! : labels[0] ?? domain;
  return root
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function parseHuf(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function labeledHuf(body: string, label: string): number | null {
  const normalized = normalizeText(body);
  const escaped = normalizeText(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:?\\s*\\n?\\s*([0-9][0-9 .]*)\\s*(?:Ft|HUF)\\b`, 'i'));
  return match?.[1] ? parseHuf(match[1]) : null;
}

function parseProducts(body: string): ProductExtraction[] {
  const normalized = normalizeText(body);
  const sectionMatch = normalized.match(/\brendeles reszletei\s*:\s*([\s\S]*?)(?=\nrendelt termekek erteke osszesen\s*:|\nszallitas\s*\(|\nvegosszeg\s*:)/i);
  if (!sectionMatch?.[1]) return [];
  const section = sectionMatch[1];
  const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
  const products: ProductExtraction[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const quantityLineIndex = lines.slice(i, Math.min(lines.length, i + 6)).findIndex((line) => /^\d+\s*db\.?\s*[x×]\s*[0-9][0-9 .]*\s*Ft\s*=\s*[0-9][0-9 .]*\s*Ft$/i.test(line));
    if (quantityLineIndex < 0) continue;
    const qIndex = i + quantityLineIndex;
    const priceMatch = lines[qIndex]!.match(/^(\d+)\s*db\.?\s*[x×]\s*([0-9][0-9 .]*)\s*Ft\s*=\s*([0-9][0-9 .]*)\s*Ft$/i);
    if (!priceMatch?.[1] || !priceMatch[2] || !priceMatch[3]) continue;

    const name = lines[i]!;
    if (!name || /^(?:iz|meret|szin|egyeb|marka|brand)\s*:/i.test(normalizeText(name))) continue;
    const quantity = Number(priceMatch[1]);
    const unitPrice = parseHuf(priceMatch[2]);
    const totalPrice = parseHuf(priceMatch[3]);
    if (!Number.isFinite(quantity) || quantity <= 0 || unitPrice === null || totalPrice === null) continue;

    const details = lines.slice(i + 1, qIndex).filter((line) => !/^(?:Scitec Nutrition|BioTechUSA)$/i.test(line));
    products.push({
      name,
      brand: null,
      model: null,
      variant: details.length ? details.join(' | ').slice(0, 500) : null,
      sku: null,
      gtin: null,
      category: null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      currency: 'HUF',
      product_url: null,
      image_url: null,
      confidence: 0.98,
    });
    i = qIndex;
  }

  return products.slice(0, 50);
}

function shippingMethodFromBody(body: string): string | null {
  const normalized = normalizeText(body);
  const match = normalized.match(/(?:^|\n)\s*szallitas\s*:\s*\n\s*([^\n]{3,180})/i);
  return match?.[1]?.trim() ?? null;
}

export function parseGenericHuLabelledOrderEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): GenericHuLabelledOrderParseResult | null {
  const domains = input.senderDomains.map(normalizeDomain).filter(Boolean);
  if (
    domains.length === 0 ||
    domains.some(isCarrierSenderDomain) ||
    domains.some(isSharedPlatformSenderDomain) ||
    domains.some(isPublicMailboxSenderDomain)
  ) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = input.bodyText ?? '';
  const normalizedBody = normalizeText(body);
  const context = `${subject}\n${normalizedBody}`;

  const orderMatch = context.match(/(?:^|\n|\b)rendeles\s*:\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i);
  if (!orderMatch?.[1] || !/\d/.test(orderMatch[1])) return null;

  const explicitThanks = /\bkoszonjuk megrendelesedet\b/i.test(context);
  const explicitStored = /\ba rendelest szamitogepes rendszerunk eltarolta\b/i.test(context);
  const orderDetails = /\ba rendeles reszletei\b/i.test(context);
  if (!(explicitThanks && explicitStored && orderDetails)) return null;

  const subtotal = labeledHuf(body, 'Rendelt termékek értéke összesen');
  const shippingAmount = (() => {
    const normalized = normalizeText(body);
    const section = normalized.match(/\bszallitas\s*\([^\n)]*\)\s*:\s*\n\s*([0-9][0-9 .]*)\s*Ft\b/i);
    return section?.[1] ? parseHuf(section[1]) : null;
  })();
  const total = labeledHuf(body, 'Végösszeg');
  const shippingMethod = shippingMethodFromBody(body);
  const products = parseProducts(body);
  if (total === null || subtotal === null || shippingAmount === null || !shippingMethod) return null;
  if (subtotal + shippingAmount !== total) return null;

  const cardOnlyDelivery = /fizetes csak bankkartyaval/i.test(normalizeText(shippingMethod));
  const carrier = /foxpost/i.test(normalizeText(shippingMethod)) ? 'Foxpost'
    : /packeta/i.test(normalizeText(shippingMethod)) ? 'Packeta'
      : null;

  return {
    extraction: {
      event_type: 'order_created',
      merchant: merchantFromDomain(domains[0]!),
      merchant_legal_name: null,
      order_number: orderMatch[1],
      subtotal,
      shipping_amount: shippingAmount,
      discount_amount: null,
      total,
      currency: 'HUF',
      payment_status: cardOnlyDelivery ? 'pending' : 'unknown',
      payment_method: cardOnlyDelivery ? 'bankkártya' : null,
      paid_amount: null,
      paid_currency: null,
      shipping_method: shippingMethod,
      tracking_number: null,
      carrier,
      parcel_sender: null,
      cod_amount: null,
      cod_currency: null,
      invoice_number: null,
      products,
      confidence: 0.99,
    },
    parserVersion: PARSER_VERSION,
    reasons: [
      'generic_hu_rendeles_colon_identifier',
      'explicit_thanks_for_order',
      'explicit_order_stored_sentence',
      'explicit_order_details_section',
      'reconciled_subtotal_shipping_total',
      'explicit_shipping_method',
      ...(products.length > 0 ? ['structured_hu_product_rows'] : []),
    ],
  };
}
