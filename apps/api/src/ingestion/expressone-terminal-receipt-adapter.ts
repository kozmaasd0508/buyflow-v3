import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';

const PARSER_VERSION = 'expressone-terminal-receipt-v1';
const MAX_RECEIPT_AMOUNT = 10_000_000;
const MAX_EVENT_DISTANCE_MS = 2 * 60 * 60 * 1000;

export interface ExpressOneTerminalReceipt {
  amount: number;
  currency: string;
  cardType: string | null;
}

export interface ExpressOneReceiptCandidate {
  purchaseId: string;
  totalAmount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  expectedCarrier: string | null;
  shipmentCarrier: string | null;
  shipmentLastEventAt: string | null;
}

export interface ExpressOneReceiptResolution {
  purchaseId: string | null;
  decision: 'linkable' | 'review';
  reasons: string[];
}

export interface ExpressOneTerminalReceiptPreprocessResult {
  matched: boolean;
  status?: 'processed' | 'review';
  sourceEmailId?: string;
  purchaseId?: string;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function senderIsExpressOneSlip(from: Array<{ email: string }>): boolean {
  return from.some((address) => address.email.trim().toLowerCase() === 'slip@expressone.hu');
}

export function parseExpressOneTerminalReceipt(input: {
  from: Array<{ email: string }>;
  subject?: string | null;
  bodyText?: string | null;
}): ExpressOneTerminalReceipt | null {
  if (!senderIsExpressOneSlip(input.from)) return null;
  if (normalizeText(input.subject ?? '').toLowerCase() !== 'fizetesi bizonylat') return null;

  const body = normalizeText(input.bodyText ?? '');
  if (!/\bstatus\s*:\s*success\b/i.test(body)) return null;
  if (!/\btransaction\s+type\s*:\s*(?:vasarlas|purchase)\b/i.test(body)) return null;

  const total = body.match(/\btotal\s+([A-Z]{3})\s*:\s*([0-9][0-9 .,'’]*)\b/i);
  if (!total?.[1] || !total[2]) return null;
  const currency = total[1].toUpperCase();
  const digits = total[2].replace(/[^0-9]/g, '');
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_RECEIPT_AMOUNT) return null;

  const cardMatch = body.match(/\bcard\s+type\s*:\s*([A-Za-z0-9 -]{2,40}?)(?=\s+(?:transaction|total|status|auth|rrn|terminal)\b|$)/i);
  return {
    amount,
    currency,
    cardType: cardMatch?.[1]?.trim() || null,
  };
}

function isCod(value: string | null): boolean {
  return /utanvet/i.test(normalizeText(value ?? ''));
}

function isExpressOne(value: string | null): boolean {
  return /express\s*one/i.test(normalizeText(value ?? ''));
}

export function resolveExpressOneTerminalReceipt(input: {
  receipt: ExpressOneTerminalReceipt;
  receivedAt: string;
  candidates: ExpressOneReceiptCandidate[];
}): ExpressOneReceiptResolution {
  const received = Date.parse(input.receivedAt);
  if (!Number.isFinite(received)) {
    return { purchaseId: null, decision: 'review', reasons: ['invalid_receipt_timestamp'] };
  }

  const eligible = input.candidates.filter((candidate) => {
    if (candidate.totalAmount !== input.receipt.amount) return false;
    if ((candidate.currency ?? '').toUpperCase() !== input.receipt.currency) return false;
    if (!isCod(candidate.paymentMethod)) return false;
    if (!isExpressOne(candidate.expectedCarrier)) return false;
    if (!isExpressOne(candidate.shipmentCarrier)) return false;
    if (!candidate.shipmentLastEventAt) return false;
    const eventAt = Date.parse(candidate.shipmentLastEventAt);
    return Number.isFinite(eventAt) && Math.abs(eventAt - received) <= MAX_EVENT_DISTANCE_MS;
  });

  if (eligible.length !== 1) {
    return {
      purchaseId: null,
      decision: 'review',
      reasons: eligible.length === 0
        ? ['no_single_cod_expressone_amount_time_candidate']
        : ['multiple_cod_expressone_amount_time_candidates'],
    };
  }

  return {
    purchaseId: eligible[0]?.purchaseId ?? null,
    decision: 'linkable',
    reasons: [
      'exact_expressone_slip_sender',
      'successful_card_purchase_receipt',
      'exact_amount_currency',
      'cod_purchase',
      'expressone_purchase_and_shipment',
      'shipment_event_within_2h',
      'single_candidate',
    ],
  };
}

function sourcePayload(receipt: ExpressOneTerminalReceipt, reasons: string[], previous: unknown) {
  return {
    schema_version: 2,
    event_type: 'payment_completed',
    merchant: null,
    merchant_legal_name: null,
    order_number: null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: 'paid',
    payment_method: receipt.cardType,
    paid_amount: receipt.amount,
    paid_currency: receipt.currency,
    shipping_method: null,
    tracking_number: null,
    carrier: 'Express One',
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.99,
    validation_status: 'validated',
    guardrail_reasons: ['existing_purchase_only_no_purchase_creation'],
    eligible_for_purchase_creation: false,
    extraction_source: 'deterministic_resolution',
    parser_version: PARSER_VERSION,
    parser_reasons: reasons,
    ...(previous ? { superseded_result: previous } : {}),
  };
}

export async function preprocessExpressOneTerminalReceiptNylasMessage(input: {
  grantId: string;
  messageId: string;
  sourceQuery?: string;
}): Promise<ExpressOneTerminalReceiptPreprocessResult> {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error: connectionError } = await db
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', input.grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) throw new Error(`Express One receipt grant lookup failed: ${connectionError.message}`);
  if (!connection) return { matched: false };

  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: input.grantId });
  const email = await provider.getMessage(input.messageId);
  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, 40_000)
    : (email.snippet ?? '').trim().slice(0, 40_000);
  const receipt = parseExpressOneTerminalReceipt({ from: email.from, subject: email.subject, bodyText });
  if (!receipt) return { matched: false };

  const { data: existing, error: existingError } = await db
    .from('source_emails')
    .select('id,structured_result,validated_result')
    .eq('email_connection_id', connection.id)
    .eq('provider_message_id', email.providerMessageId)
    .maybeSingle();
  if (existingError) throw new Error(`Express One receipt source lookup failed: ${existingError.message}`);

  const { data: purchases, error: purchaseError } = await db
    .from('purchases')
    .select('id,total_amount,currency,payment_method,expected_carrier,shipments(carrier,last_event_at)')
    .eq('user_id', connection.user_id)
    .eq('total_amount', receipt.amount)
    .eq('currency', receipt.currency);
  if (purchaseError) throw new Error(`Express One receipt candidate lookup failed: ${purchaseError.message}`);

  const candidates: ExpressOneReceiptCandidate[] = [];
  for (const purchase of purchases ?? []) {
    const shipments = Array.isArray(purchase.shipments) ? purchase.shipments : [];
    if (shipments.length === 0) {
      candidates.push({
        purchaseId: purchase.id,
        totalAmount: purchase.total_amount === null ? null : Number(purchase.total_amount),
        currency: purchase.currency,
        paymentMethod: purchase.payment_method,
        expectedCarrier: purchase.expected_carrier,
        shipmentCarrier: null,
        shipmentLastEventAt: null,
      });
      continue;
    }
    for (const shipment of shipments) {
      candidates.push({
        purchaseId: purchase.id,
        totalAmount: purchase.total_amount === null ? null : Number(purchase.total_amount),
        currency: purchase.currency,
        paymentMethod: purchase.payment_method,
        expectedCarrier: purchase.expected_carrier,
        shipmentCarrier: shipment.carrier ?? null,
        shipmentLastEventAt: shipment.last_event_at ?? null,
      });
    }
  }

  const resolution = resolveExpressOneTerminalReceipt({ receipt, receivedAt: email.receivedAt, candidates });
  const payload = sourcePayload(receipt, resolution.reasons, existing?.validated_result ?? existing?.structured_result ?? null);
  const now = new Date().toISOString();

  let sourceEmailId: string;
  if (existing) {
    const { error: updateError } = await db.from('source_emails').update({
      classification: 'payment_completed',
      structured_result: payload,
      validated_result: payload,
      validation_status: 'validated',
      validated_at: now,
      processed_at: now,
      processing_status: resolution.decision === 'linkable' ? 'processed' : 'review',
    }).eq('id', existing.id);
    if (updateError) throw new Error(`Express One receipt source update failed: ${updateError.message}`);
    sourceEmailId = existing.id as string;
  } else {
    const { data: inserted, error: insertError } = await db.from('source_emails').insert({
      user_id: connection.user_id,
      email_connection_id: connection.id,
      provider_message_id: email.providerMessageId,
      provider_thread_id: email.providerThreadId ?? null,
      from_address: email.from[0]?.email ?? null,
      subject: email.subject ?? null,
      received_at: email.receivedAt,
      source_query: input.sourceQuery ?? 'deterministic:expressone-terminal-receipt',
      classification: 'payment_completed',
      structured_result: payload,
      validated_result: payload,
      validation_status: 'validated',
      validated_at: now,
      processed_at: now,
      processing_status: resolution.decision === 'linkable' ? 'processed' : 'review',
    }).select('id').single();
    if (insertError || !inserted?.id) throw new Error(`Express One receipt source insert failed: ${insertError?.message ?? 'missing row'}`);
    sourceEmailId = inserted.id as string;
  }

  if (resolution.decision !== 'linkable' || !resolution.purchaseId) {
    return { matched: true, status: 'review', sourceEmailId };
  }

  const { error: linkError } = await db.from('purchase_sources').upsert({
    purchase_id: resolution.purchaseId,
    source_email_id: sourceEmailId,
    relation_type: 'payment_completed',
    confidence: 0.99,
  }, { onConflict: 'purchase_id,source_email_id' });
  if (linkError) throw new Error(`Express One receipt purchase link failed: ${linkError.message}`);

  const { error: paidError } = await db.from('purchases').update({
    payment_status: 'paid',
    paid_at: email.receivedAt,
  }).eq('id', resolution.purchaseId).eq('user_id', connection.user_id);
  if (paidError) throw new Error(`Express One receipt purchase update failed: ${paidError.message}`);

  return {
    matched: true,
    status: 'processed',
    sourceEmailId,
    purchaseId: resolution.purchaseId,
  };
}
