import type { EmailDocumentMoneyCandidate, EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_MONEY_EXTRACTOR_VERSION = 'universal-money-v4';

type Currency = EmailDocumentMoneyCandidate['currency'];

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ');
}

function normalizeCurrency(token: string): Currency | null {
  const value = token.trim().toUpperCase();
  if (value === 'FT' || value === 'HUF') return 'HUF';
  if (value === 'EUR' || value === '€') return 'EUR';
  if (value === 'USD' || value === '$') return 'USD';
  if (value === 'GBP' || value === '£') return 'GBP';
  return null;
}

function parseAmount(raw: string, currency: Currency): number | null {
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
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function moneyInText(text: string): { amount: number; currency: Currency } | null {
  const suffix = text.match(/([0-9][0-9 .,'’\u00a0]{0,18}[0-9]|[0-9])\s*(HUF|Ft|EUR|€|USD|\$|GBP|£)(?=\s|$|[.,;:)])/i);
  if (suffix?.[1] && suffix[2]) {
    const currency = normalizeCurrency(suffix[2]);
    if (currency) {
      const amount = parseAmount(suffix[1], currency);
      if (amount !== null) return { amount, currency };
    }
  }

  const prefix = text.match(/(?:^|\s)(HUF|Ft|EUR|€|USD|\$|GBP|£)\s*([0-9][0-9 .,'’\u00a0]{0,18}[0-9]|[0-9])(?=\s|$|[.,;:)])/i);
  if (prefix?.[1] && prefix[2]) {
    const currency = normalizeCurrency(prefix[1]);
    if (currency) {
      const amount = parseAmount(prefix[2], currency);
      if (amount !== null) return { amount, currency };
    }
  }
  return null;
}

const COD_COLLECTION_AMOUNT_LABEL = /(?:\b(?:kuldemeny|csomag)\w*.{0,48}\batvetelekor\s+fizetendo(?:\s+osszeg)?\b|\bamount\s+to\s+be\s+cleared\b.{0,80}\btime\s+of\s+receiving\b.{0,48}\bparcel\b)/i;
const STRONG_FINAL_TOTAL_LABEL = /\b(?:fizetendo(?:\s+osszeg)?|brutto\s+osszeg|vegosszeg|grand\s+total|order\s+total|total\s+amount|amount\s+due)\b/i;
const INTERMEDIATE_TOTAL_LABEL = /\b(?:reszosszeg|subtotal|goods\s+total|items?\s+total|products?\s+total|value\s+of\s+goods|(?:termek(?:ek)?|aru(?:k)?|products?|items?|goods).{0,32}\bosszesen)\b/i;
const GENERIC_TOTAL_LABEL = /\bosszesen\b/i;
const PAYMENT_AMOUNT_LABEL = /\b(?:fizetett\s+osszeg|befizetett\s+osszeg|tranzakcio\s+osszege|fizetes\s+osszege|payment\s+amount|paid\s+amount|amount\s+paid)\b/i;

function claimPair(input: {
  amount: number;
  currency: Currency;
  source: 'subject' | 'body' | 'document_structure';
  confidence: number;
  qualifier: string;
}): EvidenceClaim[] {
  const totalClaim: EvidenceClaim<number> = {
    field: 'total',
    value: input.amount,
    confidence: input.confidence,
    source: input.source,
    extractorId: 'universal-money',
    extractorVersion: UNIVERSAL_MONEY_EXTRACTOR_VERSION,
    qualifiers: [input.qualifier],
  };
  const currencyClaim: EvidenceClaim<Currency> = {
    field: 'currency',
    value: input.currency,
    confidence: input.confidence,
    source: input.source,
    extractorId: 'universal-money',
    extractorVersion: UNIVERSAL_MONEY_EXTRACTOR_VERSION,
    qualifiers: [input.qualifier],
  };
  return [totalClaim, currencyClaim];
}

function scanLabeledText(
  text: string,
  source: 'subject' | 'body',
): EvidenceClaim[] {
  const lines = text.split(/\r?\n/);
  const claims: EvidenceClaim[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const normalized = normalizeText(line);
    const codCollectionMatch = normalized.match(COD_COLLECTION_AMOUNT_LABEL);
    const paymentMatch = normalized.match(PAYMENT_AMOUNT_LABEL);
    const strongFinalMatch = normalized.match(STRONG_FINAL_TOTAL_LABEL);
    const intermediateMatch = normalized.match(INTERMEDIATE_TOTAL_LABEL);
    const genericTotalMatch = normalized.match(GENERIC_TOTAL_LABEL);

    const match = codCollectionMatch ?? paymentMatch ?? strongFinalMatch ?? intermediateMatch ?? genericTotalMatch;
    if (!match) continue;

    const nextLine = lines.slice(index + 1).find((candidate) => Boolean(candidate.trim())) ?? '';
    const labelIndex = match.index ?? 0;
    const money = moneyInText(line.slice(labelIndex)) ?? moneyInText(nextLine);
    if (!money) continue;

    let qualifier: string;
    let confidence: number;
    if (codCollectionMatch) {
      qualifier = 'explicit_cod_collection_amount';
      confidence = source === 'subject' ? 0.97 : 0.99;
    } else if (paymentMatch) {
      qualifier = 'explicit_payment_amount';
      confidence = source === 'subject' ? 0.95 : 0.97;
    } else if (strongFinalMatch) {
      qualifier = 'explicit_final_total';
      confidence = source === 'subject' ? 0.985 : 0.995;
    } else if (intermediateMatch) {
      qualifier = 'explicit_intermediate_total';
      confidence = source === 'subject' ? 0.91 : 0.93;
    } else {
      qualifier = 'explicit_generic_total';
      confidence = source === 'subject' ? 0.95 : 0.97;
    }

    claims.push(...claimPair({
      ...money,
      source,
      confidence,
      qualifier,
    }));
  }
  return claims;
}

function dedupe(claims: EvidenceClaim[]): EvidenceClaim[] {
  const best = new Map<string, EvidenceClaim>();
  for (const claim of claims) {
    const claimKey = `${claim.field}:${String(claim.value).toUpperCase()}`;
    const current = best.get(claimKey);
    if (!current || claim.confidence > current.confidence) best.set(claimKey, claim);
  }
  return [...best.values()];
}

export const universalMoneyExtractor: EvidenceExtractor = {
  id: 'universal-money',
  version: UNIVERSAL_MONEY_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims: EvidenceClaim[] = [
      ...scanLabeledText(document.subject ?? '', 'subject'),
      ...scanLabeledText(document.text, 'body'),
    ];

    if (document.signals.amounts.length === 1) {
      const candidate = document.signals.amounts[0]!;
      claims.push(...claimPair({
        amount: candidate.amount,
        currency: candidate.currency,
        source: 'document_structure',
        confidence: 0.70,
        qualifier: 'single_unambiguous_money_candidate',
      }));
    }

    return dedupe(claims);
  },
};
