import type { EmailExtraction, ProductExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender } from '../email/sender-role.js';

const PARSER_VERSION = 'gymbeam-order-processing-v1';

export interface GymBeamOrderProcessingParseResult {
  extraction: EmailExtraction;
  lifecycleEvent: 'order_processing';
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

function parseHuf(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function labeledHuf(text: string, label: string): number | null {
  const normalized = normalizeText(text);
  const escaped = normalizeText(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:\\s*([0-9][0-9 .]*)\\s*(?:Ft|HUF)\\b`, 'i'));
  return match?.[1] ? parseHuf(match[1]) : null;
}

function lineAfterLabel(text: string, label: string): string | null {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trim());
  const expected = normalizeText(label).toLowerCase();
  for (const line of lines) {
    const normalized = normalizeText(line).toLowerCase();
    if (!normalized.startsWith(expected)) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const value = line.slice(colon + 1).trim();
    if (value) return value;
  }
  return null;
}

function parseProducts(text: string): ProductExtraction[] {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const summaryIndex = lines.findIndex((line) => /\brendelesi osszesito\b/i.test(normalizeText(line)));
  if (summaryIndex < 0) return [];

  const products: ProductExtraction[] = [];
  let index = summaryIndex + 1;
  while (index < lines.length) {
    const normalizedLine = normalizeText(lines[index] ?? '');
    if (/^(?:szallitas|utanvet|szallitasi mod|fizetesi mod|brutto osszeg)\s*:/i.test(normalizedLine)) break;

    const start = (lines[index] ?? '').match(/^(\d+)\s*x\s+(.{2,300})$/i);
    if (!start?.[1] || !start[2]) {
      index += 1;
      continue;
    }

    const quantity = Number(start[1]);
    const name = start[2].trim();
    const details: string[] = [];
    let price: number | null = null;
    let cursor = index + 1;

    while (cursor < lines.length) {
      const raw = lines[cursor] ?? '';
      const normalized = normalizeText(raw);
      if (/^\d+\s*x\s+/i.test(raw)) break;
      if (/^(?:szallitas|utanvet|szallitasi mod|fizetesi mod|brutto osszeg)\s*:/i.test(normalized)) break;

      const priceMatch = raw.match(/^([0-9][0-9 .]*)\s*(?:Ft|HUF)$/i);
      if (priceMatch?.[1]) {
        price = parseHuf(priceMatch[1]);
        cursor += 1;
        break;
      }
      details.push(raw);
      cursor += 1;
    }

    if (Number.isFinite(quantity) && quantity > 0 && name && price !== null) {
      products.push({
        name,
        brand: null,
        model: null,
        variant: details.length > 0 ? details.join(' | ').slice(0, 500) : null,
        sku: null,
        gtin: null,
        category: null,
        quantity,
        unit_price: Number((price / quantity).toFixed(2)),
        total_price: price,
        currency: 'HUF',
        product_url: null,
        image_url: null,
        confidence: 0.99,
      });
    }
    index = Math.max(cursor, index + 1);
  }

  return products.slice(0, 50);
}

export function parseGymBeamOrderProcessingEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): GymBeamOrderProcessingParseResult | null {
  if (!isMerchantSender(input.senderDomains, 'gymbeam')) return null;

  const subject = normalizeText(input.subject ?? '');
  const bodyText = input.bodyText ?? '';
  const body = normalizeText(bodyText);

  if (!/\brendelesed feldolgozas alatt van\b/i.test(subject)) return null;
  if (!/\bmegkaptuk a rendelesedet\b/i.test(body)) return null;
  if (!/\brendelesi osszesito\b/i.test(body)) return null;

  const orderMatch = body.match(/\ba\s+(\d{8,20})\s+szamu\s+rendelesed\s+mar\s+keszul\b/i);
  if (!orderMatch?.[1]) return null;

  const total = labeledHuf(bodyText, 'Bruttó összeg');
  const shippingAmount = labeledHuf(bodyText, 'Szállítás');
  const codFee = labeledHuf(bodyText, 'Utánvét');
  const paymentMethod = lineAfterLabel(bodyText, 'Fizetési mód');
  const shippingMethod = lineAfterLabel(bodyText, 'Szállítási mód');
  const products = parseProducts(bodyText);
  const productSubtotal = products.length > 0
    ? Number(products.reduce((sum, product) => sum + (product.total_price ?? 0), 0).toFixed(2))
    : null;

  if (total === null || !paymentMethod || !shippingMethod || products.length === 0) return null;
  const isCod = /utanvet/i.test(normalizeText(paymentMethod));
  const carrier = /express\s*one/i.test(normalizeText(shippingMethod)) ? 'Express One' : null;

  const expectedTotal = productSubtotal !== null && shippingAmount !== null
    ? productSubtotal + shippingAmount + (codFee ?? 0)
    : null;
  if (expectedTotal !== null && expectedTotal !== total) return null;

  return {
    extraction: {
      event_type: 'order_updated',
      merchant: 'GymBeam',
      merchant_legal_name: 'GymBeam Germany GmbH',
      order_number: orderMatch[1],
      subtotal: productSubtotal,
      shipping_amount: shippingAmount,
      discount_amount: null,
      total,
      currency: 'HUF',
      payment_status: isCod ? 'cash_on_delivery' : 'pending',
      payment_method: paymentMethod,
      paid_amount: null,
      paid_currency: null,
      shipping_method: shippingMethod,
      tracking_number: null,
      carrier,
      parcel_sender: null,
      cod_amount: isCod ? total : null,
      cod_currency: isCod ? 'HUF' : null,
      invoice_number: null,
      products,
      confidence: 0.99,
    },
    lifecycleEvent: 'order_processing',
    parserVersion: PARSER_VERSION,
    reasons: [
      'known_gymbeam_sender',
      'explicit_order_processing_subject',
      'explicit_order_received_sentence',
      'explicit_order_number',
      'explicit_order_summary',
      'explicit_total',
      'explicit_payment_method',
      'explicit_shipping_method',
      'structured_product_rows',
      ...(expectedTotal === total ? ['reconciled_order_total'] : []),
    ],
  };
}
