import { classifyEmailSenderRole, type EmailSenderRole } from '../email/sender-role.js';
import type {
  BuyFlowEmailEventType,
  EmailExtraction,
  PaymentStatus,
} from './openai-email-extractor.js';

export interface OllamaEmailExtractionResult {
  extraction: EmailExtraction;
  model: string;
  promptTokens: number | null;
  outputTokens: number | null;
  totalDurationMs: number | null;
}

const ALL_EVENT_TYPES: readonly BuyFlowEmailEventType[] = [
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
];

const CARRIER_EVENT_TYPES: readonly BuyFlowEmailEventType[] = [
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'return',
  'refund',
  'other',
];

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'paid',
  'pending',
  'unpaid',
  'failed',
  'refunded',
  'cash_on_delivery',
  'unknown',
];

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
  const carrierBlockedString = carrier ? ({ type: 'null' } as const) : nullableString;
  const carrierBlockedNumber = carrier ? ({ type: 'null' } as const) : nullableNumber;
  const carrierBlockedPaymentStatus = carrier
    ? ({ type: 'null' } as const)
    : nullablePaymentStatus;

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

function instructionsFor(senderRole: EmailSenderRole): string[] {
  const instructions = [
    'You are BuyFlow Local AI V1. Read the commerce email as evidence for a persistent purchase record in a buyer app.',
    'Extract factual evidence only. Never invent identifiers, companies, products, prices, payment facts, parcel senders, tracking numbers, invoice numbers, or URLs.',
    'Use null for missing scalar fields and [] when there are no purchased products in this email.',
    'For an order confirmation, extract every purchased line item into products.',
    'Do not treat delivery fees, discounts, coupons, marketing recommendations, related products, loyalty offers, or upsells as purchased products.',
    'Return the order identifier itself in order_number without labels or decorative prefixes such as #.',
    'Distinguish order total from amount already paid and from cash-on-delivery amount.',
    'payment_completed means the email explicitly confirms a successful payment.',
    'A shipment, delivery, invoice, return, or refund email must not be treated as order_created unless the email itself clearly establishes a new purchase.',
    'Distinguish merchant from merchant_legal_name and parcel_sender.',
    'Top-level confidence is confidence in the event identity and core interpretation, not permission to write to the database.',
    'Return only the JSON object required by the supplied schema.',
  ];

  if (senderRole === 'carrier') {
    instructions.push(
      'The technical email sender is a known parcel carrier, not the merchant.',
      'For a known carrier sender, never classify the email as order_created, order_updated, or payment_completed.',
      'For a known carrier sender, merchant, merchant_legal_name, order_number, purchase totals, purchase payment fields, shipping_method, and products must remain empty/null.',
      'For a known carrier sender, extract logistics evidence such as tracking_number, carrier, parcel_sender, cod_amount/cod_currency, and shipment or delivery state when explicitly present.',
      'Do not convert parcel_sender into merchant.',
    );
  }

  return instructions;
}

function normalizeOrderNumber(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^#\s*/, '').trim();
  return normalized || null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function nanosecondsToMilliseconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value / 1_000_000
    : null;
}

function parseOllamaContent(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const message = (response as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function validateExtraction(value: unknown): EmailExtraction {
  if (!value || typeof value !== 'object') {
    throw new Error('Ollama structured extraction was not an object.');
  }

  const extraction = value as EmailExtraction;
  if (
    typeof extraction.confidence !== 'number' ||
    !ALL_EVENT_TYPES.includes(extraction.event_type) ||
    !Array.isArray(extraction.products)
  ) {
    throw new Error('Ollama structured extraction was incomplete.');
  }

  extraction.order_number = normalizeOrderNumber(extraction.order_number);
  return extraction;
}

export async function extractEmailWithOllamaResult(input: {
  model?: string;
  baseUrl?: string;
  subject?: string;
  fromDomains?: string[];
  bodyText: string;
  fetchImpl?: typeof fetch;
}): Promise<OllamaEmailExtractionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const model = input.model ?? process.env.OLLAMA_MODEL ?? 'qwen3:30b';
  const baseUrl = (input.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434')
    .replace(/\/+$/, '');
  const senderRole = classifyEmailSenderRole(input.fromDomains ?? []);
  const schema = extractionSchema(senderRole);
  const userMessage = [
    'Subject: ' + (input.subject ?? ''),
    'Sender domains: ' + (input.fromDomains ?? []).join(', '),
    'Sender role: ' + senderRole,
    'Email body:',
    input.bodyText,
  ].join('\n');

  const response = await fetchImpl(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      format: schema,
      messages: [
        { role: 'system', content: instructionsFor(senderRole).join(' ') },
        { role: 'user', content: userMessage },
      ],
      options: {
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const json = (await response.json()) as unknown;
  const content = parseOllamaContent(json);
  if (!content) throw new Error('Ollama response did not contain message.content.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Ollama response was not valid JSON.');
  }

  return {
    extraction: validateExtraction(parsed),
    model,
    promptTokens:
      json && typeof json === 'object'
        ? nonNegativeInteger((json as { prompt_eval_count?: unknown }).prompt_eval_count)
        : null,
    outputTokens:
      json && typeof json === 'object'
        ? nonNegativeInteger((json as { eval_count?: unknown }).eval_count)
        : null,
    totalDurationMs:
      json && typeof json === 'object'
        ? nanosecondsToMilliseconds((json as { total_duration?: unknown }).total_duration)
        : null,
  };
}

export async function extractEmailWithOllama(input: {
  model?: string;
  baseUrl?: string;
  subject?: string;
  fromDomains?: string[];
  bodyText: string;
  fetchImpl?: typeof fetch;
}): Promise<EmailExtraction> {
  return (await extractEmailWithOllamaResult(input)).extraction;
}
