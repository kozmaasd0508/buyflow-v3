import type { EmailDocumentMoneyCandidate, EmailDocumentProductCandidate, EmailDocumentV1 } from '../ingestion/email-document.js';
import type { EvidenceClaim, EvidenceProduct } from './types.js';
import type { EvidenceExtractor } from './collector.js';

export const UNIVERSAL_PRODUCT_EXTRACTOR_VERSION = 'universal-product-v1';

type Currency = EmailDocumentMoneyCandidate['currency'];

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
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

function stripTrailingMoney(value: string): string {
  return value
    .replace(/\s*(?:[-–—|]\s*)?[0-9][0-9 .,'’\u00a0]{0,18}\s*(?:HUF|Ft|EUR|€|USD|\$|GBP|£)\s*$/i, '')
    .replace(/\s*(?:[-–—|]\s*)?(?:HUF|Ft|EUR|€|USD|\$|GBP|£)\s*[0-9][0-9 .,'’\u00a0]{0,18}\s*$/i, '')
    .trim();
}

const NOISE_PREFIX = /^(?:szallitas|shipping|delivery|utanvet|cash on delivery|cod|fizetes|payment|kedvezmeny|discount|kupon|coupon|afa|vat|ado|tax|dij|fee|subtotal|reszosszeg|osszesen|total|vegosszeg|grand total|fizetendo)\b/i;

function cleanName(value: string): string | null {
  const cleaned = value
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—•·]+\s*/, '')
    .replace(/\s*[-–—•·]+$/, '')
    .trim();
  const normalized = normalizeText(cleaned).toLowerCase();
  if (cleaned.length < 2 || cleaned.length > 240) return null;
  if (!/[\p{L}]/u.test(cleaned)) return null;
  if (NOISE_PREFIX.test(normalized)) return null;
  if (/^(?:https?:\/\/|www\.|mailto:)/i.test(cleaned)) return null;
  return cleaned;
}

function validQuantity(value: number | null): number | null {
  if (value == null) return null;
  return Number.isInteger(value) && value > 0 && value <= 100 ? value : null;
}

function canonicalFromDocument(candidate: EmailDocumentProductCandidate): EvidenceProduct | null {
  const name = cleanName(candidate.name);
  const quantity = validQuantity(candidate.quantity);
  if (!name || quantity == null) return null;
  return {
    name,
    quantity,
    unitPrice: candidate.unitPrice ?? null,
    totalPrice: candidate.totalPrice ?? null,
    currency: candidate.currency ?? null,
  };
}

function claim(product: EvidenceProduct, confidence: number, source: 'body' | 'document_structure', qualifier: string): EvidenceClaim<EvidenceProduct> {
  return {
    field: 'product',
    value: product,
    confidence,
    source,
    extractorId: 'universal-product',
    extractorVersion: UNIVERSAL_PRODUCT_EXTRACTOR_VERSION,
    qualifiers: [qualifier],
  };
}

function parseQuantityLine(line: string): number | null {
  const normalized = normalizeText(line);
  const match = normalized.match(/^\s*(?:mennyiseg|quantity|qty|darab|db)\s*[:：-]?\s*(\d{1,3})(?:\s*(?:db|pcs?|pieces?))?\s*$/i);
  if (!match?.[1]) return null;
  return validQuantity(Number(match[1]));
}

function parsePriceLine(line: string, kind: 'unit' | 'total'): { amount: number; currency: Currency } | null {
  const normalized = normalizeText(line).toLowerCase();
  const label = kind === 'unit'
    ? /^(?:egysegar|unit price|item price|termek ara|product price|price)\s*[:：-]?/i
    : /^(?:termek osszesen|sor osszesen|line total|item total|product total)\s*[:：-]?/i;
  if (!label.test(normalized)) return null;
  return moneyInText(line);
}

function labeledProductBlocks(text: string): EvidenceClaim<EvidenceProduct>[] {
  const lines = text.split(/\r?\n/);
  const claims: EvidenceClaim<EvidenceProduct>[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^\s*(?:term[eé]k|megnevez[eé]s|product|item)\s*[:：-]\s*(.+?)\s*$/i);
    const name = cleanName(match?.[1] ?? '');
    if (!name) continue;

    let quantity: number | null = null;
    let unitPrice: number | null = null;
    let totalPrice: number | null = null;
    let currency: Currency | null = null;

    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 7); lookahead += 1) {
      const candidate = lines[lookahead] ?? '';
      if (/^\s*(?:term[eé]k|megnevez[eé]s|product|item)\s*[:：-]/i.test(candidate)) break;
      quantity ??= parseQuantityLine(candidate);
      const unit = parsePriceLine(candidate, 'unit');
      if (unit) {
        unitPrice ??= unit.amount;
        currency ??= unit.currency;
      }
      const total = parsePriceLine(candidate, 'total');
      if (total) {
        totalPrice ??= total.amount;
        currency ??= total.currency;
      }
    }

    claims.push(claim({ name, quantity, unitPrice, totalPrice, currency }, quantity == null ? 0.92 : 0.97, 'body', 'explicit_product_block'));
  }
  return claims;
}

function quantityPrefixedRows(text: string): EvidenceClaim<EvidenceProduct>[] {
  const claims: EvidenceClaim<EvidenceProduct>[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^\s*(\d{1,3})\s*[x×]\s+(.+?)\s*$/i);
    if (!match?.[1] || !match[2]) continue;
    const quantity = validQuantity(Number(match[1]));
    if (quantity == null) continue;

    const money = moneyInText(match[2]);
    const name = cleanName(stripTrailingMoney(match[2]));
    if (!name) continue;
    claims.push(claim({
      name,
      quantity,
      unitPrice: null,
      totalPrice: null,
      currency: money?.currency ?? null,
    }, money ? 0.96 : 0.95, 'body', 'quantity_prefixed_product_row'));
  }
  return claims;
}

function tableProductRows(text: string): EvidenceClaim<EvidenceProduct>[] {
  const claims: EvidenceClaim<EvidenceProduct>[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.includes('|') && !rawLine.includes('\t')) continue;
    const separator = rawLine.includes('|') ? '|' : '\t';
    const cells = rawLine.split(separator).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 3 || cells.length > 8) continue;

    const quantityIndex = cells.findIndex((cell) => /^\d{1,3}(?:\s*(?:db|pcs?|pieces?))?$/i.test(normalizeText(cell)));
    if (quantityIndex < 0) continue;
    const quantity = validQuantity(Number((cells[quantityIndex] ?? '').match(/\d{1,3}/)?.[0] ?? ''));
    if (quantity == null) continue;

    const moneyEntries = cells
      .map((cell, index) => ({ index, money: moneyInText(cell) }))
      .filter((entry): entry is { index: number; money: { amount: number; currency: Currency } } => Boolean(entry.money));
    if (moneyEntries.length === 0) continue;

    const nameCell = cells.find((cell, index) => index !== quantityIndex && !moneyEntries.some((entry) => entry.index === index) && Boolean(cleanName(cell)));
    const name = cleanName(nameCell ?? '');
    if (!name) continue;

    const firstMoney = moneyEntries[0]!.money;
    const lastMoney = moneyEntries[moneyEntries.length - 1]!.money;
    claims.push(claim({
      name,
      quantity,
      unitPrice: moneyEntries.length >= 2 ? firstMoney.amount : null,
      totalPrice: moneyEntries.length >= 2 ? lastMoney.amount : null,
      currency: lastMoney.currency,
    }, moneyEntries.length >= 2 ? 0.98 : 0.95, 'body', 'structured_table_product_row'));
  }
  return claims;
}

function productKey(product: EvidenceProduct): string {
  const normalizedName = normalizeText(product.name).toLowerCase().replace(/\s+/g, ' ');
  return [normalizedName, product.quantity ?? '', product.unitPrice ?? '', product.totalPrice ?? '', product.currency ?? ''].join('|');
}

function dedupe(claims: EvidenceClaim<EvidenceProduct>[]): EvidenceClaim<EvidenceProduct>[] {
  const best = new Map<string, EvidenceClaim<EvidenceProduct>>();
  for (const item of claims) {
    const key = productKey(item.value);
    const current = best.get(key);
    if (!current || item.confidence > current.confidence) best.set(key, item);
  }
  return [...best.values()];
}

export const universalProductExtractor: EvidenceExtractor = {
  id: 'universal-product',
  version: UNIVERSAL_PRODUCT_EXTRACTOR_VERSION,
  extract(document: EmailDocumentV1): EvidenceClaim[] {
    const claims: EvidenceClaim<EvidenceProduct>[] = [];
    for (const candidate of document.signals.products) {
      const product = canonicalFromDocument(candidate);
      if (product) claims.push(claim(product, 0.98, 'document_structure', 'document_product_candidate'));
    }
    claims.push(...labeledProductBlocks(document.text));
    claims.push(...quantityPrefixedRows(document.text));
    claims.push(...tableProductRows(document.text));
    return dedupe(claims);
  },
};
