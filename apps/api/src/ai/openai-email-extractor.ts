import { classifyEmailSenderRole, type EmailSenderRole } from '../email/sender-role.js';

export type BuyFlowEmailEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'return'
  | 'refund'
  | 'subscription'
  | 'other';

export type PaymentStatus =
  | 'paid'
  | 'pending'
  | 'unpaid'
  | 'failed'
  | 'refunded'
  | 'cash_on_delivery'
  | 'unknown';

export interface ProductExtraction {
  name: string;
  brand: string | null;
  model: string | null;
  variant: string | null;
  sku: string | null;
  gtin: string | null;
  category: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
  currency: string | null;
  product_url: string | null;
  image_url: string | null;
  confidence: number;
}

export interface EmailExtraction {
  event_type: BuyFlowEmailEventType;
  merchant: string | null;
  merchant_legal_name: string | null;
  order_number: string | null;
  subtotal: number | null;
  shipping_amount: number | null;
  discount_amount: number | null;
  total: number | null;
  currency: string | null;
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  paid_amount: number | null;
  paid_currency: string | null;
  shipping_method: string | null;
  tracking_number: string | null;
  carrier: string | null;
  parcel_sender: string | null;
  cod_amount: number | null;
  cod_currency: string | null;
  invoice_number: string | null;
  products: ProductExtraction[];
  confidence: number;
}

export interface OpenAIEmailExtractionResult {
  extraction: EmailExtraction;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
}

const ALL_EVENT_TYPES = [
  'order_created',
  'order_updated',
  'payment_completed',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'return',
  'refund',
  'subscription',
  'other',
] as const;

const CARRIER_EVENT_TYPES = [
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'return',
  'refund',
  'other',
] as const;

const PAYMENT_STATUSES = [
  'paid',
  'pending',
  'unpaid',
  'failed',
  'refunded',
  'cash_on_delivery',
  'unknown',
] as const;

const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const nullablePaymentStatus = {
  type: ['string', 'null'],
  enum: [...PAYMENT_STATUSES, null],
} as const;

const productSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    brand: nullableString,
    model: nullableString,
    variant: nullableString,
    sku: nullableString,
    gtin: nullableString,
    category: nullableString,
    quantity: nullableNumber,
    unit_price: nullableNumber,
    total_price: nullableNumber,
    currency: nullableString,
    product_url: nullableString,
    image_url: nullableString,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'name',
    'brand',
    'model',
    'variant',
    'sku',
    'gtin',
    'category',
    'quantity',
    'unit_price',
    'total_price',
    'currency',
    'product_url',
    'image_url',
    'confidence',
  ],
} as const;

function extractionSchema(senderRole: EmailSenderRole) {
  const carrier = senderRole === 'carrier';
  const carrierBlockedString = carrier ? { type: 'null' } as const : nullableString;
  const carrierBlockedNumber = carrier ? { type: 'null' } as const : nullableNumber;
  const carrierBlockedPaymentStatus = carrier ? { type: 'null' } as const : nullablePaymentStatus;

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      event_type: {
        type: 'string',
        enum: carrier ? CARRIER_EVENT_TYPES : ALL_EVENT_TYPES,
      },
      merchant: carrierBlockedString,
      merchant_legal_name: carrierBlockedString,
      order_number: carrierBlockedString,
      subtotal: carrierBlockedNumber,
      shipping_amount: carrierBlockedNumber,
      discount_amount: carrierBlockedNumber,
      total: carrierBlockedNumber,
      currency: carrierBlockedString,
      payment_status: carrierBlockedPaymentStatus,
      payment_method: carrierBlockedString,
      paid_amount: carrierBlockedNumber,
      paid_currency: carrierBlockedString,
      shipping_method: carrierBlockedString,
      tracking_number: nullableString,
      carrier: nullableString,
      parcel_sender: nullableString,
      cod_amount: nullableNumber,
      cod_currency: nullableString,
      invoice_number: nullableString,
      products: carrier
        ? { type: 'array', items: productSchema, maxItems: 0 }
        : { type: 'array', items: productSchema, maxItems: 50 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
      'event_type',
      'merchant',
      'merchant_legal_name',
      'order_number',
      'subtotal',
      'shipping_amount',
      'discount_amount',
      'total',
      'currency',
      'payment_status',
      'payment_method',
      'paid_amount',
      'paid_currency',
      'shipping_method',
      'tracking_number',
      'carrier',
      'parcel_sender',
      'cod_amount',
      'cod_currency',
      'invoice_number',
      'products',
      'confidence',
    ],
  } as const;
}

function outputText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === 'string') return direct;

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
  }
  return '';
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function parseUsage(response: unknown) {
  if (!response || typeof response !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
    };
  }

  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
    };
  }

  const details = (usage as { input_tokens_details?: unknown }).input_tokens_details;
  const cachedInputTokens =
    details && typeof details === 'object'
      ? nonNegativeInteger((details as { cached_tokens?: unknown }).cached_tokens)
      : null;

  return {
    inputTokens: nonNegativeInteger((usage as { input_tokens?: unknown }).input_tokens),
    outputTokens: nonNegativeInteger((usage as { output_tokens?: unknown }).output_tokens),
    totalTokens: nonNegativeInteger((usage as { total_tokens?: unknown }).total_tokens),
    cachedInputTokens,
  };
}

function preserveUsefulAnchorUrls(html: string): string {
  return html.replace(
    /<a\b[^>]*href\s*=\s*(["'])(https?:\/\/[^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote: string, href: string, labelHtml: string) => {
      const label = labelHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const safeHref = href.trim().slice(0, 500);
      return `${label || 'link'} [URL: ${safeHref}]`;
    },
  );
}

export function htmlToCompactText(html: string, maxChars = 20_000): string {
  return preserveUsefulAnchorUrls(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, maxChars);
}

function normalizeOrderNumber(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^#\s*/, '').trim();
  return normalized || null;
}

export async function extractEmailWithOpenAIResult(input: {
  apiKey: string;
  model?: string;
  subject?: string;
  fromDomains?: string[];
  bodyText: string;
  fetchImpl?: typeof fetch;
}): Promise<OpenAIEmailExtractionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const senderRole = classifyEmailSenderRole(input.fromDomains ?? []);
  const instructions = [
    'You are BuyFlow AI V2 Prompt V2. Your job is evidence-grounded extraction from one commerce email. You do not decide database writes or whether this email links to an existing Purchase.',
    'Work in this order internally: first identify the sender role and the primary transactional event in the current email, then extract only fields that are directly supported by the subject, body, visible labelled data, or explicit URLs.',
    'Never invent, repair, complete, translate into a different identifier, or guess identifiers, companies, products, prices, payment facts, parcel senders, tracking numbers, invoice numbers, or URLs. If evidence is ambiguous, conflicting, or merely plausible, return null for that scalar field.',
    'Treat quoted older messages, signatures, legal footers, social links, unsubscribe content, marketing recommendations, loyalty offers, related products, cross-sells, and generic navigation as background noise unless the current transactional event explicitly depends on them.',
    'Use null for missing scalar fields and [] when there are no purchased products in this email. Never use a high confidence score to compensate for missing evidence.',
    'Classify order_created only when the email clearly establishes that a merchant accepted, confirmed, or created a purchase/order. A cart reminder, checkout-started email, quote, offer, pro-forma, payment authorization alone, order-request acknowledgement, or wording that says acceptance will happen later is not sufficient for order_created.',
    'Classify order_updated when the email is about an already existing order and materially updates it without being better represented by payment_completed, shipment, delivery, invoice_or_receipt, return, refund, subscription, or other.',
    'Classify payment_completed only when successful payment is explicitly confirmed. Do not classify a payment confirmation as order_created unless the same email independently and clearly establishes creation or acceptance of the order.',
    'Classify shipment only for a present or completed logistics handoff or shipment state. Future wording such as will be shipped, preparing for shipment, label created, data received, or courier will collect is not proof that the parcel has actually been handed to a carrier.',
    'Classify delivery only when the email explicitly reports a delivery-stage event such as out for delivery, delivery attempt, ready for pickup when that is the current delivery state, or delivered. Do not infer delivery from the mere presence of a tracking link.',
    'Classify invoice_or_receipt only when the email itself contains or clearly announces an invoice, fiscal receipt, or purchase receipt. A generic order summary is not automatically an invoice.',
    'For order_number, return only an identifier that is explicitly presented as the order/purchase identifier or is unambiguously embedded in the transactional subject/label. Remove only decorative punctuation such as a leading #. Preserve meaningful alphabetic or numeric prefixes and suffixes exactly; never strip a prefix merely because it looks decorative.',
    'For tracking_number, require explicit logistics context: a tracking label, parcel/shipment label, carrier context, or a tracking URL whose visible transactional context clearly identifies the value as the parcel tracking identifier. Do not promote arbitrary long numbers, URL tokens, customer IDs, phone numbers, invoice IDs, or order IDs into tracking_number.',
    'For invoice_number, require explicit invoice/receipt numbering context. Do not use order numbers, tax numbers, customer IDs, filenames, random tokens, or payment references as invoice_number.',
    'Distinguish merchant from merchant_legal_name, payment provider, marketplace/infrastructure provider, and parcel_sender. merchant is the commercial seller/store for this purchase when directly evidenced. merchant_legal_name is only a separately stated legal entity name. Do not set a carrier or payment provider as merchant merely because it sent the email.',
    'parcel_sender is the consignor/shipper named inside a carrier email, for example after Feladó, Sender, Shipper, Consignor, Versender, or equivalent wording. Do not silently convert parcel_sender into merchant.',
    'For an order confirmation, extract every purchased line item into products. Do not omit line items merely to keep the answer short.',
    'Do not treat delivery fees, shipping lines, discounts, coupons, gift-card adjustments, taxes, deposits, marketing recommendations, related products, loyalty offers, or upsells as purchased products.',
    'For each product, preserve the purchased product name faithfully. Split brand/model/variant only when directly stated in the name or labelled product data; otherwise use null. Never infer a brand from the merchant name.',
    'quantity must be null when quantity is not explicit or cannot safely be determined. Do not assume quantity 1 only because a product appears once.',
    'unit_price is the price for one unit only when that meaning is explicit. total_price is the purchased line total only when that meaning is explicit. Do not copy an old/list price, crossed-out price, saving amount, or recommendation price into either field.',
    'Use product_url or image_url only when the URL is explicitly present and clearly belongs to that purchased product, not a generic shop, tracking, footer, logo, ad, or unsubscribe link.',
    'Distinguish subtotal, shipping_amount, discount_amount, total, paid_amount, and cod_amount by their labels and meaning. Never force arithmetic reconciliation by inventing a missing amount.',
    'total is the merchant order total/final payable total only when directly evidenced as such. Do not use an individual product price, subtotal, account balance, credit limit, savings amount, or parcel COD amount as total unless the email explicitly says it is the order total.',
    'discount_amount is the magnitude of an explicitly stated discount or coupon reduction, not a negative total. shipping_amount is only the explicitly stated shipping/delivery charge.',
    'paid_amount is the amount explicitly confirmed as already paid. cod_amount is the amount explicitly due on delivery or collection. A cod_amount of 0 is meaningful evidence and must be preserved when explicitly shown.',
    'Currency may be normalized to the schema-friendly currency code only when the email explicitly provides a currency name, code, or unambiguous local symbol/notation such as Ft for HUF or € for EUR. Do not infer currency from sender country alone.',
    'payment_status must use only the schema values. Use paid only for explicit successful payment evidence, cash_on_delivery only for explicit COD payment method/status, refunded only for explicit refunded state, and unknown when payment wording exists but the state cannot be safely mapped.',
    'A shipment, delivery, invoice, return, refund, payment, or subscription email must not be treated as order_created merely because it repeats order details from an earlier purchase.',
    'When the email contains conflicting candidate values for the same field, prefer a clearly labelled current/final transactional value. If the conflict cannot be resolved from the email itself, return null rather than choosing one.',
    'Top-level confidence is confidence in the primary event identity and core interpretation of this email. Lower it for genuine ambiguity or conflicting evidence, not merely because optional product attributes are absent. Each product has its own confidence.',
    'Confidence is never permission to write to the database, create a Purchase, or link lifecycle events. BuyFlow safety and Identity Graph logic make those decisions separately.',
  ];

  if (senderRole === 'carrier') {
    instructions.push(
      'The technical email sender is a known parcel carrier, not the merchant.',
      'For a known carrier sender, never classify the email as order_created, order_updated, or payment_completed.',
      'For a known carrier sender, merchant, merchant_legal_name, order_number, purchase subtotal/total, purchase payment fields, shipping_method, and products must remain empty/null even if the carrier message repeats merchant-like or order-like text.',
      'For a known carrier sender, extract only logistics evidence that is directly present, such as tracking_number, carrier, parcel_sender, cod_amount/cod_currency, and shipment or delivery state.',
      'Do not convert the labelled parcel_sender into merchant. Keep it in parcel_sender so BuyFlow can compare it with candidate purchases safely.',
      'Carrier wording about future pickup, expected handoff, label generation, or shipment preparation is not enough for shipment unless the email also contains explicit evidence that handoff/shipment has already occurred.',
    );
  }

  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model ?? 'gpt-5.4-nano',
      store: false,
      reasoning: { effort: 'none' },
      instructions: instructions.join(' '),
      input: [
        'Subject: ' + (input.subject ?? ''),
        'Sender domains: ' + (input.fromDomains ?? []).join(', '),
        'Sender role: ' + senderRole,
        'Email body:',
        input.bodyText,
      ].join('\n'),
      text: {
        format: {
          type: 'json_schema',
          name: 'buyflow_email_extraction_v2',
          strict: true,
          schema: extractionSchema(senderRole),
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Responses API failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as unknown;
  const text = outputText(json);
  if (!text) throw new Error('OpenAI response did not contain output text.');

  const extraction = JSON.parse(text) as EmailExtraction;
  if (
    typeof extraction.confidence !== 'number' ||
    !extraction.event_type ||
    !Array.isArray(extraction.products)
  ) {
    throw new Error('OpenAI structured extraction was incomplete.');
  }
  extraction.order_number = normalizeOrderNumber(extraction.order_number);

  const responseId =
    json && typeof json === 'object' && typeof (json as { id?: unknown }).id === 'string'
      ? (json as { id: string }).id
      : null;

  return {
    extraction,
    responseId,
    ...parseUsage(json),
  };
}

export async function extractEmailWithOpenAI(input: {
  apiKey: string;
  model?: string;
  subject?: string;
  fromDomains?: string[];
  bodyText: string;
  fetchImpl?: typeof fetch;
}): Promise<EmailExtraction> {
  const result = await extractEmailWithOpenAIResult(input);
  return result.extraction;
}
