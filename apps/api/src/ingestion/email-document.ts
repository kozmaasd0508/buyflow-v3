import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import type { EmailAddress, EmailAttachmentMetadata, EmailHeader, NormalizedEmail } from '../email/types.js';

export interface EmailDocumentMoneyCandidate {
  amount: number;
  currency: 'HUF' | 'EUR' | 'USD' | 'GBP';
  raw: string;
}

export interface EmailDocumentProductCandidate {
  name: string;
  quantity: number;
  raw: string;
  unitPrice?: number;
  totalPrice?: number;
  currency?: EmailDocumentMoneyCandidate['currency'];
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
    shippingAmounts: EmailDocumentMoneyCandidate[];
    codAmounts: EmailDocumentMoneyCandidate[];
    products: EmailDocumentProductCandidate[];
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

function currencyFromToken(token: string): EmailDocumentMoneyCandidate['currency'] {
  const normalized = token.toUpperCase();
  if (normalized.includes('FT') || normalized.includes('HUF')) return 'HUF';
  if (normalized.includes('EUR') || normalized.includes('€')) return 'EUR';
  if (normalized.includes('GBP') || normalized.includes('£')) return 'GBP';
  return 'USD';
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

const MONEY_PATTERN = /([0-9][0-9 .,'’\u00a0]{0,18}[0-9]|[0-9])\s*(HUF|Ft|EUR|€|USD|\$|GBP|£)\b/i;

function moneyFromText(text: string): EmailDocumentMoneyCandidate | null {
  const match = text.match(MONEY_PATTERN);
  if (!match?.[1] || !match[2]) return null;
  const currency = currencyFromToken(match[2]);
  const amount = parseMoneyValue(match[1], currency);
  return amount === null ? null : { amount, currency, raw: match[0] ?? text };
}

function amountCandidates(text: string): EmailDocumentMoneyCandidate[] {
  const pattern = new RegExp(MONEY_PATTERN.source, 'gi');
  const results: EmailDocumentMoneyCandidate[] = [];
  for (const match of text.matchAll(pattern)) {
    if (!match[1] || !match[2]) continue;
    const currency = currencyFromToken(match[2]);
    const amount = parseMoneyValue(match[1], currency);
    if (amount !== null) results.push({ amount, currency, raw: match[0] ?? '' });
  }
  return results.slice(0, 50);
}

function labeledMoneyCandidates(text: string, labels: RegExp[]): EmailDocumentMoneyCandidate[] {
  const results: EmailDocumentMoneyCandidate[] = [];
  for (const rawLine of text.split('\n')) {
    const normalizedLine = normalizeText(rawLine).toLowerCase();
    if (!labels.some((label) => label.test(normalizedLine))) continue;
    const money = moneyFromText(rawLine);
    if (money) results.push(money);
  }
  return results.slice(0, 10);
}

function productCandidates(text: string): EmailDocumentProductCandidate[] {
  const rawLines = text.split('\n');
  const results: EmailDocumentProductCandidate[] = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = (rawLines[index] ?? '').trim();
    if (!line) continue;
    const match = line.match(/^\s*(\d{1,3})\s*[x×]\s+(.+?)\s*$/i);
    if (!match?.[1] || !match[2]) continue;
    const quantity = Number(match[1]);
    const name = match[2].trim().replace(/\s{2,}/g, ' ');
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100 || name.length < 2 || name.length > 240) continue;
    if (/^(?:szallitas|shipping|utanvet|payment|fizetes|kedvezmeny|discount)\b/i.test(normalizeText(name))) continue;

    let price: EmailDocumentMoneyCandidate | null = null;
    for (let lookahead = index + 1; lookahead < Math.min(rawLines.length, index + 6); lookahead += 1) {
      const candidateLine = (rawLines[lookahead] ?? '').trim();
      if (!candidateLine) continue;
      if (/^\s*\d{1,3}\s*[x×]\s+/i.test(candidateLine)) break;
      const normalizedCandidate = normalizeText(candidateLine).toLowerCase();
      if (/^(?:szallitas|shipping|utanvet|payment|fizetesi|brutto|vegosszeg|grand total|order total)\b/.test(normalizedCandidate)) break;
      const candidateMoney = moneyFromText(candidateLine);
      if (candidateMoney) {
        price = candidateMoney;
        break;
      }
    }

    results.push({
      name,
      quantity,
      raw: line,
      ...(price ? {
        unitPrice: quantity > 0 ? price.amount / quantity : price.amount,
        totalPrice: price.amount,
        currency: price.currency,
      } : {}),
    });
  }
  const deduped = new Map<string, EmailDocumentProductCandidate>();
  for (const result of results) {
    const key = `${result.quantity}:${normalizeText(result.name).toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, result);
  }
  return [...deduped.values()].slice(0, 50);
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
    /\b(?:rendeles|megrendeles)\s+visszaigazolasa\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/gi,
    /\border\s+confirmation\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/gi,
    /\b(?:bestellbestatigung|confirmation de commande|confirmacion de pedido)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/gi,
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
      shippingAmounts: labeledMoneyCandidates(text, [/\bszallitas\b/, /\bshipping\b/]),
      codAmounts: labeledMoneyCandidates(text, [/\butanvet\b/, /\bcash on delivery\b/, /\bcod\b/]),
      products: productCandidates(text),
      couriers: detectCouriers(normalized),
      paymentMethods: extractLabelValue(text, ['Fizetési mód', 'Fizetesi mod', 'Payment method']),
      shippingMethods: extractLabelValue(text, ['Szállítási mód', 'Szallitasi mod', 'Shipping method', 'Delivery method']),
      trackingNumbers,
    },
  };
}
