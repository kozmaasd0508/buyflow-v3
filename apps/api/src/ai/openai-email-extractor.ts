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
  payment_status: string | null;
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

const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;

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
      payment_status: carrierBlockedString,
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
    'You are BuyFlow AI V2. Read the entire commerce email as evidence for a persistent purchase record in a buyer app.',
    'Extract factual evidence, not a short summary. Never invent identifiers, companies, products, prices, payment facts, parcel senders, tracking numbers, or URLs.',
    'Use null for missing scalar fields and [] when there are no purchased products in this email.',
    'For an order confirmation, extract every purchased line item into products. Do not omit line items merely to keep the answer short.',
    'Do not treat delivery fees, discounts, coupons, marketing recommendations, related products, loyalty offers, or upsells as purchased products.',
    'For each product, preserve the product name faithfully. Split brand/model/variant only when directly stated in the name or labelled product data; otherwise use null.',
    'Use product_url or image_url only when the URL is explicitly present and clearly belongs to that purchased product, not a generic shop, tracking, footer, logo, or unsubscribe link.',
    'quantity must be null when quantity is not explicit or cannot safely be determined. Monetary fields must be null when the amount is not actually monetary evidence.',
    'Distinguish order total from amount already paid and from cash-on-delivery amount. A cod_amount of 0 is meaningful evidence and must be preserved when explicitly shown.',
    'payment_completed means the email explicitly confirms a successful payment. Do not classify a payment confirmation as order_created unless the same email also clearly establishes creation of the order.',
    'Distinguish merchant from merchant_legal_name and from parcel_sender. parcel_sender is a shipper/consignor named inside a carrier email, for example after Feladó, Sender, Shipper, Consignor, or Versender.',
    'A shipment/delivery/invoice/return/refund email must not be treated as order_created unless the email itself clearly establishes a new purchase.',
    'Confidence is confidence in the extracted event and evidence, not permission to write to the database.',
  ];

  if (senderRole === 'carrier') {
    instructions.push(
      'The technical email sender is a known parcel carrier, not the merchant.',
      'For a known carrier sender, never classify the email as order_created, order_updated, or payment_completed.',
      'For a known carrier sender, merchant, merchant_legal_name, order_number, purchase totals, purchase payment fields, shipping_method, and products must remain empty/null.',
      'For a known carrier sender, extract logistics evidence such as tracking_number, carrier, parcel_sender, cod_amount/cod_currency, and shipment or delivery state when explicitly present.',
      'Do not convert the labelled parcel_sender into merchant. Keep it in parcel_sender so BuyFlow can later compare it with candidate purchases safely.',
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
