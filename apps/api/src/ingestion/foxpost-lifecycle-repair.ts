import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { htmlToCompactText, type EmailExtraction } from '../ai/openai-email-extractor.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';

const PARSER_VERSION = 'foxpost-lifecycle-v1';
const MAX_BODY_CHARS = 80_000;

export interface FoxpostLifecycleParseResult {
  extraction: EmailExtraction;
  shipmentPhase: 'shipment_created' | 'in_transit' | 'ready_for_pickup';
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

function parseHuf(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function foxpostTracking(text: string): string | null {
  const normalized = normalizeText(text);
  const labelled = normalized.match(/\bcsomagod\s+foxpost\s+azonositoszama\s*:\s*(CLFOX\d{10,30})\b/i)
    ?? normalized.match(/\bfoxpost\s+(?:csomag)?azonosito(?:szama)?\s*:\s*(CLFOX\d{10,30})\b/i);
  return labelled?.[1]?.toUpperCase() ?? null;
}

function parcelSender(text: string): string | null {
  const normalized = normalizeText(text);
  const match = normalized.match(/\bertesitunk,?\s+hogy\s+(.{2,120}?)\s+altal\s+feladott\s+csomagod(?:hoz)?\b/i)
    ?? normalized.match(/\bcsomagod,?\s+amelyet\s+(.{2,120}?)\s+adott\s+fel\s+szamodra\b/i);
  return match?.[1]?.trim() ?? null;
}

function codAmount(text: string): number | null {
  const normalized = normalizeText(text);
  const match = normalized.match(/\butanveteli\s+osszeg\s*:\s*([0-9][0-9 .]*)\s*(?:Ft|HUF)\b/i);
  return match?.[1] ? parseHuf(match[1]) : null;
}

export function parseFoxpostLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): FoxpostLifecycleParseResult | null {
  const domains = input.senderDomains.map(normalizeDomain);
  if (!domains.some((domain) => domain === 'foxpost.hu' || domain.endsWith('.foxpost.hu'))) return null;

  const subject = normalizeText(input.subject ?? '');
  const bodyText = input.bodyText ?? '';
  const body = normalizeText(bodyText);
  const trackingNumber = foxpostTracking(bodyText);
  const sender = parcelSender(bodyText);
  if (!trackingNumber || !sender) return null;

  let shipmentPhase: FoxpostLifecycleParseResult['shipmentPhase'] | null = null;
  const reasons = ['trusted_foxpost_sender', 'explicit_foxpost_tracking', 'explicit_parcel_sender'];

  if (/\beloertesites\b/i.test(subject) && /\bmeg\s+nem\s+adtak\s+at\s+a\s+foxpost\s+reszere\b/i.test(body)) {
    shipmentPhase = 'shipment_created';
    reasons.push('explicit_pre_advice_not_yet_handed_over');
  } else if (/\bcsomagod\s+mar\s+a\s+raktarunkban\s+van\b/i.test(subject) || /\bbeerkezett\s+raktarunkba\b/i.test(body)) {
    shipmentPhase = 'in_transit';
    reasons.push('explicit_warehouse_arrival');
  } else if (
    /\bcsomagod\s+megerkezett\b/i.test(subject)
    && /\bmegerkezett,?\s+amely\s+atveheto\b/i.test(body)
    && /\bcsomagatvetel\s+hatarideje\b/i.test(body)
  ) {
    shipmentPhase = 'ready_for_pickup';
    reasons.push('explicit_ready_for_pickup_language', 'pickup_deadline_present');
  }

  if (!shipmentPhase) return null;
  const cod = codAmount(bodyText);

  return {
    extraction: {
      event_type: 'shipment',
      merchant: null,
      merchant_legal_name: null,
      order_number: null,
      subtotal: null,
      shipping_amount: null,
      discount_amount: null,
      total: null,
      currency: null,
      payment_status: null,
      payment_method: null,
      paid_amount: null,
      paid_currency: null,
      shipping_method: null,
      tracking_number: trackingNumber,
      carrier: 'Foxpost',
      parcel_sender: sender,
      cod_amount: cod,
      cod_currency: cod !== null ? 'HUF' : null,
      invoice_number: null,
      products: [],
      confidence: 0.99,
    },
    shipmentPhase,
    parserVersion: PARSER_VERSION,
    reasons,
  };
}

function senderDomains(from: Array<{ email: string }>): string[] {
  return [...new Set(from
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

export async function repairDeterministicFoxpostSourcesForGrant(grantId: string): Promise<{ scanned: number; repaired: number }> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('id,user_id').eq('provider', 'nylas').eq('provider_account_id', grantId).eq('status', 'active').maybeSingle();
  if (connectionError) throw new Error(`Foxpost repair grant lookup failed: ${connectionError.message}`);
  if (!connection?.id || !connection?.user_id) return { scanned: 0, repaired: 0 };

  const cutoff = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data: rows, error: rowsError } = await db.from('source_emails')
    .select('id,provider_message_id,from_address,subject,processing_status')
    .eq('email_connection_id', connection.id)
    .eq('user_id', connection.user_id)
    .in('processing_status', ['review', 'unlinked'])
    .gte('received_at', cutoff)
    .ilike('from_address', '%@foxpost.hu')
    .order('received_at', { ascending: true }).limit(100);
  if (rowsError) throw new Error(`Foxpost repair source scan failed: ${rowsError.message}`);

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: grantId });
  let repaired = 0;
  for (const row of (rows ?? []) as Array<Record<string, any>>) {
    if (typeof row.provider_message_id !== 'string') continue;
    const email = await provider.getMessage(row.provider_message_id);
    const bodyText = email.bodyHtml
      ? htmlToCompactText(email.bodyHtml, MAX_BODY_CHARS)
      : (email.snippet ?? '').trim().slice(0, MAX_BODY_CHARS);
    const domains = senderDomains(email.from);
    const parsed = parseFoxpostLifecycleEmail({ senderDomains: domains, subject: email.subject, bodyText });
    if (!parsed) continue;

    const validated = validateEmailExtraction({ extraction: parsed.extraction, senderDomains: domains, subject: email.subject, bodyText });
    const now = new Date().toISOString();
    const structuredResult = {
      schema_version: 2,
      ...parsed.extraction,
      shipment_phase: parsed.shipmentPhase,
      extraction_source: 'deterministic',
      parser_version: parsed.parserVersion,
      parser_reasons: parsed.reasons,
    };
    const validatedResult = JSON.parse(JSON.stringify(validated)) as Record<string, unknown>;
    validatedResult.shipment_phase = parsed.shipmentPhase;
    validatedResult.extraction_source = 'deterministic';
    validatedResult.parser_version = parsed.parserVersion;
    validatedResult.parser_reasons = parsed.reasons;

    const { error: updateError } = await db.from('source_emails').update({
      classification: 'shipment',
      structured_result: structuredResult,
      validated_result: validatedResult,
      validation_status: validated.validation_status,
      validated_at: now,
      processed_at: now,
      processing_status: 'unlinked',
    }).eq('id', row.id).eq('email_connection_id', connection.id);
    if (updateError) throw new Error(`Foxpost repair update failed: ${updateError.message}`);
    repaired += 1;
  }

  return { scanned: (rows ?? []).length, repaired };
}
