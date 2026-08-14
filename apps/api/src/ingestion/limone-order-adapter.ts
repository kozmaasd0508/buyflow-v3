import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  htmlToCompactText,
  type EmailExtraction,
  type ProductExtraction,
} from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const PARSER_VERSION = 'limone-order-v1';

export interface LimoneOrderParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
}

export interface LimoneOrderPreprocessResult {
  matched: boolean;
  sourceEmailId?: string;
  parserVersion?: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function domainMatches(domain: string, expected: string): boolean {
  const normalized = normalizeDomain(domain);
  const target = normalizeDomain(expected);
  return normalized === target || normalized.endsWith(`.${target}`);
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '');
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

function money(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9-]/g, '');
  if (!normalized || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function amountAfterLabel(body: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\n\\s*(-?[0-9][0-9 ]*)\\s*Ft\\b`, 'i'));
  return money(match?.[1]);
}

function lineAfterLabel(body: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\n\\s*([^\\n]{2,160})`, 'i'));
  return match?.[1]?.trim() || null;
}

function parseProducts(body: string): ProductExtraction[] {
  const products: ProductExtraction[] = [];
  const productPattern = /(?:^|\n)\s*([^\n]{3,240}?)(?:\s+\[URL:\s*(https?:\/\/[^\]\s]+)\])?\s+\(([^)\n]{2,40})\)\s*\n\s*(-?[0-9][0-9 ]*)\s*Ft\s*\n\s*(\d+)\s*db\s*\n\s*(-?[0-9][0-9 ]*)\s*Ft\b/gi;

  for (const match of body.matchAll(productPattern)) {
    const name = match[1]?.trim();
    const sku = match[3]?.trim();
    const unitPrice = money(match[4]);
    const quantity = Number(match[5]);
    const totalPrice = money(match[6]);
    if (!name || !sku || !Number.isFinite(quantity) || quantity <= 0) continue;
    if (unitPrice === null || totalPrice === null || unitPrice < 0 || totalPrice < 0) continue;
    if (/^kedvezmeny\b/i.test(normalizeText(name))) continue;

    products.push({
      name,
      brand: null,
      model: null,
      variant: null,
      sku,
      gtin: null,
      category: null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      currency: 'HUF',
      product_url: match[2]?.trim() || null,
      image_url: null,
      confidence: 0.99,
    });
  }

  return products.slice(0, 50);
}

export function parseLimoneOrderEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): LimoneOrderParseResult | null {
  if (!input.senderDomains.some((domain) => domainMatches(domain, 'limone.hu'))) return null;

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const subjectMatch = subject.match(/automata\s+megrendeles\s+visszaigazolas\s*-\s*([0-9]{4,10}-[0-9]{4,12})\b/i);
  if (!subjectMatch?.[1]) return null;

  const orderNumber = subjectMatch[1];
  const bodyOrder = body.match(/(?:^|\n)\s*azonosito\s*\n\s*([0-9]{4,10}-[0-9]{4,12})\b/i)?.[1] ?? null;
  const explicitOrder = /webaruhazunkban\s+rendelest\s+adott\s+le\b/i.test(body);
  const explicitConfirmation = /ez\s+egy\s+automata\s+visszaigazolas\s+a\s+megrendeles\s+leadasarol\b/i.test(body);
  if (!bodyOrder || bodyOrder !== orderNumber || !explicitOrder || !explicitConfirmation) return null;

  const subtotal = amountAfterLabel(body, 'Osszesen');
  const shippingAmount = amountAfterLabel(body, 'Szallitasi koltseg');
  const total = amountAfterLabel(body, 'Vegosszeg');
  const discountRaw = body.match(/(?:^|\n)\s*Kedvezmeny[^\n]*\n\s*(-?[0-9][0-9 ]*)\s*Ft\b/i)?.[1];
  const discount = money(discountRaw);
  const paymentMethod = lineAfterLabel(body, 'Fizetesi mod');
  const shippingMethod = lineAfterLabel(body, 'Szallitasi mod');
  const cashOnDelivery = Boolean(paymentMethod && /utanvet/i.test(normalizeText(paymentMethod)));
  const carrier = shippingMethod && /express\s*one|expressone/i.test(normalizeText(shippingMethod))
    ? 'Express One'
    : null;

  const extraction: EmailExtraction = {
    event_type: 'order_created',
    merchant: 'Limone.hu',
    merchant_legal_name: null,
    order_number: orderNumber,
    subtotal,
    shipping_amount: shippingAmount,
    discount_amount: discount !== null ? Math.abs(discount) : null,
    total,
    currency: total !== null || subtotal !== null || shippingAmount !== null ? 'HUF' : null,
    payment_status: cashOnDelivery ? 'cash_on_delivery' : 'unknown',
    payment_method: paymentMethod,
    paid_amount: null,
    paid_currency: null,
    shipping_method: shippingMethod,
    tracking_number: null,
    carrier,
    parcel_sender: null,
    cod_amount: cashOnDelivery ? total : null,
    cod_currency: cashOnDelivery && total !== null ? 'HUF' : null,
    invoice_number: null,
    products: parseProducts(body),
    confidence: 0.995,
  };

  return {
    extraction,
    parserVersion: PARSER_VERSION,
    reasons: [
      'exact_limone_sender',
      'explicit_limone_order_confirmation_subject',
      'same_order_number_in_body',
      'explicit_order_placed_sentence',
      'explicit_automatic_confirmation_sentence',
    ],
  };
}

export async function preprocessLimoneOrderNylasMessage(input: {
  grantId: string;
  messageId: string;
}): Promise<LimoneOrderPreprocessResult> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) throw new Error(`Failed to resolve Limone parser grant: ${connectionError.message}`);
  if (!connection) return { matched: false };

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);
  const domains = senderDomains(email.from);
  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml)
    : (email.snippet ?? '').trim().slice(0, 20_000);
  const parsed = parseLimoneOrderEmail({ senderDomains: domains, subject: email.subject, bodyText });
  if (!parsed) return { matched: false };

  const validated = validateEmailExtraction({
    extraction: parsed.extraction,
    senderDomains: domains,
    subject: email.subject,
    bodyText,
  });
  const now = new Date().toISOString();
  const structuredResult = {
    schema_version: 2,
    ...parsed.extraction,
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };
  const validatedResult = {
    ...(JSON.parse(JSON.stringify(validated)) as Record<string, unknown>),
    extraction_source: 'deterministic',
    parser_version: parsed.parserVersion,
    parser_reasons: parsed.reasons,
  };

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', input.messageId)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check Limone source dedupe: ${existingError.message}`);

  if (existing?.validated_result) {
    return { matched: true, sourceEmailId: existing.id as string, parserVersion: parsed.parserVersion };
  }

  if (existing) {
    const { error: updateError } = await db
      .from('source_emails')
      .update({
        classification: 'order_created',
        structured_result: structuredResult,
        validated_result: validatedResult,
        validation_status: validated.validation_status,
        validated_at: now,
        processed_at: now,
        processing_status: 'review',
      })
      .eq('id', existing.id);
    if (updateError) throw new Error(`Failed to update Limone source email: ${updateError.message}`);
    return { matched: true, sourceEmailId: existing.id as string, parserVersion: parsed.parserVersion };
  }

  const { data: inserted, error: insertError } = await db
    .from('source_emails')
    .insert({
      user_id: connection.user_id,
      email_connection_id: connection.id,
      provider_message_id: email.providerMessageId,
      provider_thread_id: email.providerThreadId ?? null,
      from_address: email.from[0]?.email ?? null,
      subject: email.subject ?? null,
      received_at: email.receivedAt,
      source_query: 'deterministic:limone-order',
      classification: 'order_created',
      structured_result: structuredResult,
      validated_result: validatedResult,
      validation_status: validated.validation_status,
      validated_at: now,
      processed_at: now,
      processing_status: 'review',
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`Failed to save Limone source email: ${insertError?.message ?? 'missing row'}`);
  }

  return { matched: true, sourceEmailId: inserted.id as string, parserVersion: parsed.parserVersion };
}
