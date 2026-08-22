import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import type { DeterministicCommerceParseResult } from './deterministic-commerce-parser.js';

function domain(email: NormalizedEmail): string {
  const address = email.from[0]?.email?.trim().toLowerCase() ?? '';
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

function domainMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.endsWith(`.${expected}`);
}

function bodyText(email: NormalizedEmail): string {
  return email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, 80_000)
    : (email.snippet ?? '');
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseAmount(value: string): number | null {
  const normalized = value
    .replace(/[\u00a0\s.]/g, '')
    .replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'FT' || normalized === 'HUF') return 'HUF';
  if (normalized === '€' || normalized === 'EUR') return 'EUR';
  if (normalized === '$' || normalized === 'USD') return 'USD';
  return null;
}

function moneyAfterLabel(text: string, label: RegExp): { amount: number; currency: string } | null {
  for (const line of text.split(/\r?\n/)) {
    if (!label.test(line)) continue;
    const match = line.match(/([0-9][0-9\s.,\u00a0]*)\s*(Ft|HUF|EUR|€|USD|\$)\b/i);
    if (!match?.[1] || !match[2]) continue;
    const amount = parseAmount(match[1]);
    const currency = normalizeCurrency(match[2]);
    if (amount !== null && currency) return { amount, currency };
  }
  return null;
}

function explicitTotal(text: string): { amount: number; currency: string } | null {
  return moneyAfterLabel(text, /\b(?:összesen|fizetendő|fizetendő összeg|bruttó összeg|végösszeg|grand total|order total|total amount|total)\b/i);
}

function explicitPaymentAmount(text: string): { amount: number; currency: string } | null {
  return moneyAfterLabel(text, /\b(?:fizetett összeg|befizetett összeg|tranzakció összege|fizetés összege|payment amount|paid amount|amount|összeg)\b/i);
}

function explicitCodAmount(text: string): { amount: number; currency: string } | null {
  return moneyAfterLabel(text, /\b(?:utánvét|utánvétes|utánvéti|utánvét(?:es)?(?:i)? összeg(?:e)?|beszedendő összeg|cash on delivery|cash on delivery amount|cod|cod amount|fizetendő összeg)\b/i);
}

function hasExplicitPaidEvidence(subject: string, text: string): boolean {
  const source = `${subject}\n${text}`;
  return /\b(?:sikeres fizet[eé]s|sikeresen fizett[eé]l|sikeresen rendezte|fizet[eé]s megerős[ií]t[eé]se|fizet[eé]s megt[oö]rt[eé]nt|fizet[eé]s teljes[ií]tve|kifizetve|sikeres tranzakci[oó]|tranzakci[oó] sikeres|sikeres befizet[eé]s|befizet[eé]s be[eé]rkezett|payment successful|payment confirmed|payment completed|successfully paid|paid successfully)\b/i.test(source);
}

function hasExplicitCodEvidence(text: string): boolean {
  return /(?:fizet[eé]si\s+m[oó]d|payment\s+method)\s*:?\s*(?:ut[aá]nv[eé]t(?:el|tel|es)?|cash on delivery|cod)\b/i.test(text)
    || /\b(?:ut[aá]nv[eé]t(?:es)?(?:i)?\s+[oö]sszeg(?:e)?|beszedend[oő]\s+[oö]sszeg|cash on delivery amount|cod amount)\b/i.test(text);
}

function genericOrderNumber(subject: string, text: string): string | null {
  return firstMatch(`${subject}\n${text}`, [
    /(?:megrendel[eé]s|rendel[eé]s)\s+(?:visszaigazol[aá]sa|visszaigazol[aá]s)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{4,30})\b/i,
    /(?:megrendel[eé]s|rendel[eé]s)(?:i)?\s+(?:sz[aá]m|azonos[ií]t[oó])\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{4,30})\b/i,
  ]);
}

function courierSenderDomain(senderDomain: string): boolean {
  return [
    'dpd.hu',
    'gls-hungary.com',
    'posta.hu',
    'expressone.hu',
    'foxpost.hu',
    'packeta.hu',
    'dhl.com',
    'ups.com',
    'fedex.com',
  ].some((candidate) => domainMatches(senderDomain, candidate));
}

function senderMerchantName(email: NormalizedEmail, senderDomain: string): string | null {
  if (courierSenderDomain(senderDomain)) return null;
  const name = email.from[0]?.name?.normalize('NFKC').trim() ?? '';
  if (name.length < 2 || name.length > 120 || name.includes('@')) return null;
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (/^(?:no-?reply|noreply|info|support|customer service|ugyfelszolgalat|webshop|shop|ertesites|notification|mailer|robot)$/i.test(normalized)) return null;
  return name;
}

/**
 * Conservative field-only enrichment for already-recognized commerce events.
 * This layer never changes event_type and never creates a match on its own.
 * It only fills or repairs fields when there is explicit source evidence.
 */
export function enrichProviderFieldsV1(
  email: NormalizedEmail,
  parsed: DeterministicCommerceParseResult,
): DeterministicCommerceParseResult {
  const senderDomain = domain(email);
  const subject = email.subject ?? '';
  const body = bodyText(email);
  const text = `${subject}\n${body}`;
  const extraction = { ...parsed.extraction };
  const reasons = [...parsed.reasons];

  if (domainMatches(senderDomain, 'dpd.hu')) {
    if (!extraction.carrier) extraction.carrier = 'DPD';
    const currentTracking = extraction.tracking_number?.trim() ?? '';
    const validCurrentTracking = /^\d{10,18}$/.test(currentTracking);
    if (!validCurrentTracking) {
      const candidate = firstMatch(subject, [
        /(?:Értesítés|Ertesites)\s+(\d{10,18})\b/i,
      ]);
      if (candidate) {
        extraction.tracking_number = candidate;
        reasons.push('field_enrichment_v1_dpd_tracking_repaired');
      }
    }
    if (extraction.tracking_number && validCurrentTracking) reasons.push('field_enrichment_v1_dpd_tracking');
  }

  if (domainMatches(senderDomain, 'gls-hungary.com')) {
    if (!extraction.carrier) extraction.carrier = 'GLS';
    if (!extraction.tracking_number) {
      extraction.tracking_number = firstMatch(text, [
        /\b(?:CSOMAGSZ[AÁ]M|parcel\s+number)\s*:?\s*(\d{9,14})\b/i,
        /\b(\d{9,14})\s+sz[aá]m[uú]\s+csomag\b/i,
        /\bGLS\s+(\d{9,14})\b/i,
      ]);
    }
    if (extraction.tracking_number) reasons.push('field_enrichment_v1_gls_tracking');
  }

  if (domainMatches(senderDomain, 'posta.hu')) {
    if (!extraction.carrier) extraction.carrier = 'MPL';
    if (!extraction.tracking_number) {
      extraction.tracking_number = firstMatch(text, [
        /(?:k[uü]ldem[eé]nyazonos[ií]t[oó]|csomagazonos[ií]t[oó])\s*[:#-]?\s*([A-Z0-9]{10,24})\b/i,
        /\b([A-Z]{2}[A-Z0-9]{10,22})\b/i,
      ]);
    }
    if (extraction.tracking_number) reasons.push('field_enrichment_v1_mpl_tracking');
  }

  if (domainMatches(senderDomain, 'expressone.hu')) {
    if (!extraction.carrier) extraction.carrier = 'Express One';
    if (!extraction.tracking_number) {
      extraction.tracking_number = firstMatch(text, [
        /(?:k[uü]ldem[eé]ny(?:azonos[ií]t[oó])?|csomag(?:azonos[ií]t[oó])?)\s*[:#-]?\s*(\d{12,30})\b/i,
        /\b(\d{20,30})\b/,
      ]);
    }
    if (extraction.tracking_number) reasons.push('field_enrichment_v1_expressone_tracking');
  }

  if (domainMatches(senderDomain, 'acct.epicgames.com') && extraction.event_type === 'invoice_or_receipt') {
    if (!extraction.order_number) {
      extraction.order_number = firstMatch(text, [
        /(?:sz[aá]mlaazonos[ií]t[oó]|rendel[eé]s(?:i)?\s+(?:azonos[ií]t[oó]|sz[aá]m))\s*[:#-]?\s*([A-Z]\d{12,22})\b/i,
        /\b(A\d{16})\b/,
      ]);
    }
    if (extraction.order_number) reasons.push('field_enrichment_v1_epic_order_number');
  }

  if (!extraction.merchant && courierSenderDomain(senderDomain) && extraction.parcel_sender?.trim()) {
    extraction.merchant = extraction.parcel_sender.trim();
    reasons.push('field_enrichment_v1_parcel_sender_merchant');
  }

  if (!extraction.merchant) {
    const merchant = senderMerchantName(email, senderDomain);
    if (merchant) {
      extraction.merchant = merchant;
      reasons.push('field_enrichment_v1_sender_merchant_name');
    }
  }

  if (extraction.event_type === 'order_created' && !extraction.order_number) {
    const candidate = genericOrderNumber(subject, body);
    if (candidate) {
      extraction.order_number = candidate;
      reasons.push('field_enrichment_v1_explicit_order_number');
    }
  }

  const amountEligible = [
    'order_created',
    'order_updated',
    'shipment',
    'invoice_or_receipt',
    'payment_completed',
  ].includes(extraction.event_type);

  if (amountEligible && (extraction.total == null || !extraction.currency)) {
    const total = explicitTotal(body)
      ?? (extraction.event_type === 'payment_completed' ? explicitPaymentAmount(body) : null)
      ?? (extraction.event_type === 'shipment' ? explicitCodAmount(body) : null);
    if (total) {
      if (extraction.total == null) extraction.total = total.amount;
      if (!extraction.currency) extraction.currency = total.currency;
      reasons.push('field_enrichment_v1_explicit_total');
    }
  }

  if ((extraction.event_type === 'payment_completed' || extraction.event_type === 'invoice_or_receipt')
      && !extraction.payment_status
      && hasExplicitPaidEvidence(subject, body)) {
    extraction.payment_status = 'paid';
    reasons.push('field_enrichment_v1_explicit_paid_status');
  }

  if (['order_created', 'order_updated', 'shipment'].includes(extraction.event_type)
      && !extraction.payment_status
      && hasExplicitCodEvidence(body)) {
    extraction.payment_status = 'cash_on_delivery';
    reasons.push('field_enrichment_v1_explicit_cod_status');
  }

  return {
    ...parsed,
    extraction,
    reasons: [...new Set(reasons)],
  };
}
