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

const extractionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    event_type: {
      type: 'string',
      enum: [
        'order_created',
        'order_updated',
        'shipment',
        'delivery',
        'invoice_or_receipt',
        'return',
        'refund',
        'subscription',
        'other',
      ],
    },
    merchant: { type: ['string', 'null'] },
    order_number: { type: ['string', 'null'] },
    tracking_number: { type: ['string', 'null'] },
    carrier: { type: ['string', 'null'] },
    invoice_number: { type: ['string', 'null'] },
    total: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
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

export async function extractEmailWithOpenAI(input: {
  apiKey: string;
  model?: string;
  subject?: string;
  fromDomains?: string[];
  bodyText: string;
  fetchImpl?: typeof fetch;
}): Promise<EmailExtraction> {
  const fetchImpl = input.fetchImpl ?? fetch;
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
      instructions: [
        'You extract evidence from commerce emails for BuyFlow.',
        'Never invent identifiers or facts.',
        'Use null for missing fields.',
        'A shipment/delivery/invoice/return/refund email must not be treated as order_created unless the email itself clearly establishes a new purchase.',
        'Confidence is confidence in the extracted event and fields, not a request to take action.',
      ].join(' '),
      input: [
        'Subject: ' + (input.subject ?? ''),
        'Sender domains: ' + (input.fromDomains ?? []).join(', '),
        'Email body:',
        input.bodyText,
      ].join('\n'),
      text: {
        format: {
          type: 'json_schema',
          name: 'buyflow_email_extraction',
          strict: true,
          schema: extractionSchema,
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

  const parsed = JSON.parse(text) as EmailExtraction;
  if (typeof parsed.confidence !== 'number' || !parsed.event_type) {
    throw new Error('OpenAI structured extraction was incomplete.');
  }
  return parsed;
}
