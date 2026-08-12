import { classifyEmailSenderRole, type EmailSenderRole } from '../email/sender-role.js';

export type BuyFlowEmailEventType =
  | 'order_created'
  | 'order_updated'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'return'
  | 'refund'
  | 'subscription'
  | 'other';

export interface EmailExtraction {
  event_type: BuyFlowEmailEventType;
  merchant: string | null;
  order_number: string | null;
  tracking_number: string | null;
  carrier: string | null;
  invoice_number: string | null;
  total: number | null;
  currency: string | null;
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

function extractionSchema(senderRole: EmailSenderRole) {
  const carrier = senderRole === 'carrier';
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      event_type: {
        type: 'string',
        enum: carrier ? CARRIER_EVENT_TYPES : ALL_EVENT_TYPES,
      },
      merchant: carrier ? { type: 'null' } : { type: ['string', 'null'] },
      order_number: carrier ? { type: 'null' } : { type: ['string', 'null'] },
      tracking_number: { type: ['string', 'null'] },
      carrier: { type: ['string', 'null'] },
      invoice_number: { type: ['string', 'null'] },
      total: carrier ? { type: 'null' } : { type: ['number', 'null'] },
      currency: carrier ? { type: 'null' } : { type: ['string', 'null'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: [
      'event_type',
      'merchant',
      'order_number',
      'tracking_number',
      'carrier',
      'invoice_number',
      'total',
      'currency',
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

export function htmlToCompactText(html: string, maxChars = 12_000): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
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
    'You extract evidence from commerce emails for BuyFlow.',
    'Never invent identifiers or facts.',
    'Use null for missing fields.',
    'A shipment/delivery/invoice/return/refund email must not be treated as order_created unless the email itself clearly establishes a new purchase.',
    'Confidence is confidence in the extracted event and fields, not a request to take action.',
  ];

  if (senderRole === 'carrier') {
    instructions.push(
      'The sender is a known parcel carrier, not the merchant.',
      'For a known carrier sender, never classify the email as order_created or order_updated.',
      'For a known carrier sender, merchant, order_number, total, and currency must remain null; extract logistics evidence such as tracking_number, carrier, shipment or delivery state when present.',
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
          name: 'buyflow_email_extraction',
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
  if (typeof extraction.confidence !== 'number' || !extraction.event_type) {
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
