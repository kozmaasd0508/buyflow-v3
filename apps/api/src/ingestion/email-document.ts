import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import type { EmailAddress, EmailAttachmentMetadata, EmailHeader, NormalizedEmail } from '../email/types.js';

export interface EmailDocumentMoneyCandidate {
  amount: number;
  currency: 'HUF' | 'EUR' | 'USD' | 'GBP';
  raw: string;
}

export interface EmailDocumentSection {
  type: 'order_summary' | 'shipping' | 'payment' | 'invoice' | 'other';
  text: string;
}

export interface EmailDocumentV1 {
  schemaVersion: 1;
  provider: NormalizedEmail['provider'];
  providerMessageId: string;
  receivedAt: string;
  sender: {
    addresses: EmailAddress[];
    domains: string[];
    primaryEmail: string | null;
    primaryDomain: string | null;
    primaryName: string | null;
  };
  recipients: {
    to: EmailAddress[];
    cc: EmailAddress[];
    bcc: EmailAddress[];
  };
  subject: string | null;
  text: string;
  html: string | null;
  headers: EmailHeader[];
  attachments: EmailAttachmentMetadata[];
  sections: EmailDocumentSection[];
  signals: {
    orderNumbers: string[];
    amounts: EmailDocumentMoneyCandidate[];
    couriers: string[];
    paymentMethods: string[];
    shippingMethods: string[];
    trackingNumbers: string[];
  };
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '');
}

function senderDomains(addresses: EmailAddress[]): string[] {
  return [...new Set(addresses
    .map((address) => address.email.trim().toLowerCase())
    .map((address) => address.slice(address.lastIndexOf('@') + 1))
    .filter((domain) => Boolean(domain) && !domain.includes('@')))];
}

function uniqueMatches(text: string, patterns: RegExp[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(matcher)) {
      const value = match[1]?.trim().replace(/[.,;:)]+$/, '');
      if (value && /\d/.test(value)) results.push(value);
    }
  }
  return [...new Set(results)];
}

function parseMoneyValue(raw: string, currency: EmailDocumentMoneyCandidate['currency']): number | null {
  let value = raw.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (!value) return null;
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    value = decimals === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (dot >= 0 && currency === 'HUF') {
    const decimals = value.length - dot - 1;
    if (decimals !== 2) value = value.replace(/\./g, '');
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function amountCandidates(text: string): EmailDocumentMoneyCandidate[] {
  const pattern = /([0-9][0-9 .,'’\u00a0]{0,18}[0-9]|[0-9])\s*(HUF|Ft|EUR|€|USD|\$|GBP|£)\b/gi;
  const results: EmailDocumentMoneyCandidate[] = [];
  for (const match of text.matchAll(pattern)) {
    const token = (match[2] ?? '').toUpperCase();
    const currency: EmailDocumentMoneyCandidate['currency'] = token.includes('FT') || token.includes('HUF')
      ? 'HUF'
      : token.includes('EUR') || token.includes('€')
        ? 'EUR'
        : token.includes('GBP') || token.includes('£')
          ? 'GBP'
          : 'USD';
    const amount = parseMoneyValue(match[1] ?? '', currency);
    if (amount !== null) results.push({ amount, currency, raw: match[0] ?? '' });
  }
  return results.slice(0, 50);
}

function extractLabelValue(text: string, labels: string[]): string[] {
  const values: string[] = [];
  const normalized = text.split('\n');
  for (const line of normalized) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^\\s*${label}\\s*[:：-]\\s*(.+?)\\s*$`, 'i'));
      if (match?.[1]) values.push(match[1].trim());
    }
  }
  return [...new Set(values)];
}

function detectCouriers(text: string): string[] {
  const normalized = normalizeText(text).toLowerCase();
  const candidates: Array<[RegExp, string]> = [
    [/\bexpress\s*one\b/, 'Express One'],
    [/\bgls\b/, 'GLS'],
    [/\bdpd\b/, 'DPD'],
    [/\bfoxpost\b/, 'Foxpost'],
    [/\bpacketa\b/, 'Packeta'],
    [/\bdhl\b/, 'DHL'],
    [/\bups\b/, 'UPS'],
    [/\bmpl\b|magyar posta/, 'MPL'],
  ];
  return candidates.filter(([pattern]) => pattern.test(normalized)).map(([, name]) => name);
}

function detectSections(text: string): EmailDocumentSection[] {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sections: EmailDocumentSection[] = [];
  for (const line of lines) {
    const normalized = normalizeText(line).toLowerCase();
    const type: EmailDocumentSection['type'] = /rendelesi osszesito|order summary|order details/.test(normalized)
      ? 'order_summary'
      : /szallitasi mod|shipping method|delivery method/.test(normalized)
        ? 'shipping'
        : /fizetesi mod|payment method/.test(normalized)
          ? 'payment'
          : /szamla|invoice/.test(normalized)
            ? 'invoice'
            : 'other';
    if (type !== 'other') sections.push({ type, text: line });
  }
  return sections.slice(0, 20);
}

export function buildEmailDocumentV1(email: NormalizedEmail): EmailDocumentV1 {
  const text = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, 100_000)
    : (email.snippet ?? '').trim().slice(0, 100_000);
  const normalized = normalizeText(`${email.subject ?? ''}\n${text}`);
  const domains = senderDomains(email.from);
  const primary = email.from[0] ?? null;

  const orderNumbers = uniqueMatches(normalized, [
    /\b(?:order|rendeles|megrendeles)(?:\s*(?:number|no\.?|id|szam|szama|azonosito))?\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/gi,
    /\ba\s+([a-z0-9][a-z0-9._/-]{4,39})\s+szamu\s+(?:rendelesed|megrendelesed|rendeles|megrendeles)\b/gi,
  ]);
  const trackingNumbers = uniqueMatches(normalized, [
    /\b(?:tracking(?:\s*(?:number|no\.?|id))?|nyomkovetesi\s*(?:szam|azonosito)|csomag(?:szam|azonosito))\s*[:#-]?\s*([a-z0-9][a-z0-9-]{7,31})\b/gi,
  ]).map((value) => value.toUpperCase());

  return {
    schemaVersion: 1,
    provider: email.provider,
    providerMessageId: email.providerMessageId,
    receivedAt: email.receivedAt,
    sender: {
      addresses: email.from,
      domains,
      primaryEmail: primary?.email ?? null,
      primaryDomain: domains[0] ?? null,
      primaryName: primary?.name ?? null,
    },
    recipients: { to: email.to, cc: email.cc, bcc: email.bcc },
    subject: email.subject ?? null,
    text,
    html: email.bodyHtml ?? null,
    headers: email.headers ?? [],
    attachments: email.attachments,
    sections: detectSections(text),
    signals: {
      orderNumbers,
      amounts: amountCandidates(normalized),
      couriers: detectCouriers(normalized),
      paymentMethods: extractLabelValue(text, ['Fizetési mód', 'Fizetesi mod', 'Payment method']),
      shippingMethods: extractLabelValue(text, ['Szállítási mód', 'Szallitasi mod', 'Shipping method', 'Delivery method']),
      trackingNumbers,
    },
  };
}
