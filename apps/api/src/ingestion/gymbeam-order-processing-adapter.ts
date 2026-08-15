import type { EmailExtraction, ProductExtraction } from '../ai/openai-email-extractor.js';
import { isMerchantSender } from '../email/sender-role.js';

const PARSER_VERSION = 'gymbeam-order-processing-v1.1';
const STOP_LABELS = 'Szállítás|Utánvét|Szállítási mód|Fizetési mód|Bruttó összeg|Szállítási cím|Számlázási cím';
const PRODUCT_DETAIL_LABEL = /\b(?:Grammsúly|Ízesítés|Kapszula|Méret|Kiszerelés(?:\s*\(ml\))?|Tabletta)\s*:/i;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labeledHuf(text: string, label: string): number | null {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  const escaped = escapeRegExp(normalizeText(label));
  const match = normalized.match(new RegExp(`\\b${escaped}\\s*:\\s*([0-9][0-9 .]*)\\s*(?:Ft|HUF)\\b`, 'i'));
  return match?.[1] ? parseHuf(match[1]) : null;
}

function valueAfterLabel(text: string, label: string): string | null {
  const collapsed = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const match = collapsed.match(new RegExp(
    `${escapeRegExp(label)}\\s*:\\s*(.+?)(?=\\s+(?:${STOP_LABELS})\\s*:|$)`,
    'i',
  ));
  return match?.[1]?.trim() || null;
}

function product(input: {
  quantity: number;
  name: string;
  variant: string | null;
  totalPrice: number;
}): ProductExtraction {
  return {
    name: input.name,
    brand: null,
    model: null,
    variant: input.variant,
    sku: null,
    gtin: null,
    category: null,
    quantity: input.quantity,
    unit_price: Number((input.totalPrice / input.quantity).toFixed(2)),
    total_price: input.totalPrice,
    currency: 'HUF',
    product_url: null,
    image_url: null,
    confidence: 0.99,
  };
}

function splitNameAndVariant(value: string): { name: string; variant: string | null } {
  const detail = PRODUCT_DETAIL_LABEL.exec(value);
  if (!detail || detail.index <= 0) {
    return { name: value.trim(), variant: null };
  }
  return {
    name: value.slice(0, detail.index).trim(),
    variant: value.slice(detail.index).trim().slice(0, 500) || null,
  };
}

function parseProductsByLines(text: string): ProductExtraction[] {
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
      products.push(product({
        quantity,
        name,
        variant: details.length > 0 ? details.join(' | ').slice(0, 500) : null,
        totalPrice: price,
      }));
    }
    index = Math.max(cursor, index + 1);
  }
  return products.slice(0, 50);
}

function parseProductsCollapsed(text: string): ProductExtraction[] {
  const collapsed = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const summary = collapsed.match(/Rendelési összesítő\s*:\s*([\s\S]+?)(?=\s+Szállítás\s*:)/i);
  if (!summary?.[1]) return [];
  const section = summary[1].trim();

  const starts = [...section.matchAll(/(?:^|\s)(\d+)\s*x\s+/gi)];
  const products: ProductExtraction[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const quantityText = start?.[1];
    if (!quantityText || start.index === undefined) continue;
    const quantity = Number(quantityText);
    const prefixLength = start[0].length;
    const chunkStart = start.index + prefixLength;
    const chunkEnd = starts[i + 1]?.index ?? section.length;
    const chunk = section.slice(chunkStart, chunkEnd).trim();
    const priceMatches = [...chunk.matchAll(/([0-9][0-9 .]*)\s*(?:Ft|HUF)\b/gi)];
    const priceMatch = priceMatches.at(-1);
    if (!priceMatch?.[1] || priceMatch.index === undefined || !Number.isFinite(quantity) || quantity <= 0) continue;
    const totalPrice = parseHuf(priceMatch[1]);
    if (totalPrice === null) continue;
    const description = chunk.slice(0, priceMatch.index).trim();
    const parsed = splitNameAndVariant(description);
    if (!parsed.name) continue;
    products.push(product({ quantity, name: parsed.name, variant: parsed.variant, totalPrice }));
  }
  return products.slice(0, 50);
}

function parseProducts(text: string): ProductExtraction[] {
  const lineBased = parseProductsByLines(text);
  const collapsed = parseProductsCollapsed(text);
  return collapsed.length > lineBased.length ? collapsed : lineBased;
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
  const paymentMethod = valueAfterLabel(bodyText, 'Fizetési mód');
  const shippingMethod = valueAfterLabel(bodyText, 'Szállítási mód');
  const products = parseProducts(bodyText);
  const productSubtotal = products.length > 0
    ? Number(products.reduce((sum, item) => sum + (item.total_price ?? 0), 0).toFixed(2))
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
