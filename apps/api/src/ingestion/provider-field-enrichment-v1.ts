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

/**
 * Conservative field-only enrichment for already-recognized commerce events.
 * This layer never changes event_type and never creates a match on its own.
 * It only fills fields that are currently null, and only behind trusted
 * provider domains plus provider-specific identifier shapes.
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
    if (!extraction.tracking_number) {
      extraction.tracking_number = firstMatch(subject, [
        /(?:Értesítés|Ertesites)\s+(\d{10,18})\b/i,
      ]);
    }
    if (extraction.tracking_number) reasons.push('field_enrichment_v1_dpd_tracking');
  }

  if (domainMatches(senderDomain, 'gls-hungary.com')) {
    if (!extraction.carrier) extraction.carrier = 'GLS';
    if (!extraction.tracking_number) {
      extraction.tracking_number = firstMatch(subject, [
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

  return {
    ...parsed,
    extraction,
    reasons: [...new Set(reasons)],
  };
}
