import type { EmailExtraction, ProductExtraction } from '../ai/openai-email-extractor.js';
import { isCarrierSenderDomain } from '../email/sender-role.js';

const PARSER_VERSION = 'generic-order-confirmation-v1.2';

const SHARED_PLATFORM_SENDER_DOMAINS = [
  'shopifyemail.com',
  'my.store-emails.com',
  'squarespace.info',
] as const;

const PUBLIC_MAILBOX_SENDER_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.de',
  'yahoo.fr',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'aol.com',
  'freemail.hu',
  'citromail.hu',
  'indamail.hu',
  'vipmail.hu',
] as const;

const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'net',
  'org',
]);

export interface GenericOrderParseResult {
  extraction: EmailExtraction;
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

function domainMatches(domain: string, expected: string): boolean {
  const normalized = normalizeDomain(domain);
  const target = normalizeDomain(expected);
  return normalized === target || normalized.endsWith(`.${target}`);
}

export function isSharedPlatformSenderDomain(domain: string): boolean {
  return SHARED_PLATFORM_SENDER_DOMAINS.some((shared) => domainMatches(domain, shared));
}

export function isPublicMailboxSenderDomain(domain: string): boolean {
  return PUBLIC_MAILBOX_SENDER_DOMAINS.some((provider) => domainMatches(domain, provider));
}

function merchantFromDomain(domain: string): string {
  const normalized = normalizeDomain(domain);
  const labels = normalized.split('.').filter(Boolean);
  const last = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  const third = labels.at(-3) ?? '';
  const multiLabelCountrySuffix =
    last.length === 2 &&
    COMMON_SECOND_LEVEL_SUFFIXES.has(second) &&
    Boolean(third);
  const root = multiLabelCountrySuffix ? third : (second || last || normalized);

  return root
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ') || normalized;
}

const CONFIRMATION_PATTERNS = [
  /\bthank(?:s| you)? for your order\b/i,
  /\byour order (?:is )?confirmed\b/i,
  /\border confirmation\b/i,
  /\bwe (?:have )?received your order\b/i,
  /\bwe've received your order\b/i,
  /\bmegrendeles(?:ed|e)? (?:sikeresen )?(?:rogzitettuk|beerk(?:ezett|ezett)|megerositve|visszaigazolva)\b/i,
  /\bkoszonjuk (?:a |az )?(?:rendelesed|megrendelesed|rendeleset|megrendeleset)\b/i,
  /\brendeles visszaigazolas\b/i,
  /\bmegrendeles visszaigazolas\b/i,
  /\bbestellbest(?:a|ae)tigung\b/i,
  /\bvielen dank f(?:u|ue)r (?:ihre|deine) bestellung\b/i,
  /\bwir haben (?:ihre|deine) bestellung erhalten\b/i,
  /\bconfirmation de commande\b/i,
  /\bmerci pour votre commande\b/i,
  /\bnous avons bien recu votre commande\b/i,
  /\bconfirmacion de (?:tu |su )?pedido\b/i,
  /\bgracias por (?:tu |su )?pedido\b/i,
];

const SUBJECT_PATTERNS = [
  /\border confirmation\b/i,
  /\border #?[a-z0-9][a-z0-9._/-]{2,31} (?:confirmed|received)\b/i,
  /\brendeles(?:i)? visszaigazolas\b/i,
  /\bmegrendeles(?:i)? visszaigazolas\b/i,
  /\bbestellbest(?:a|ae)tigung\b/i,
  /\bconfirmation de commande\b/i,
  /\bconfirmacion de pedido\b/i,
];

const ORDER_PATTERNS = [
  /\border\s*(?:number|no\.?|id)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\border\s*#\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:rendeles|megrendeles)\s*:\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:rendeles(?:szam|\s+szama|\s+azonosito)|megrendeles(?:szam|\s+szama|\s+azonosito))\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:bestellnummer|bestellnr\.?|auftragsnummer)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:numero de commande|commande n[°o]?|n[°o]? de commande)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:numero de pedido|pedido n[°o]?|pedido)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
];

const TOTAL_LABELS = [
  'grand total',
  'order total',
  'amount due',
  'vegosszeg',
  'fizetendo',
  'osszesen fizetendo',
  'gesamtbetrag',
  'gesamtsumme',
  'total ttc',
  'total de la commande',
  'total del pedido',
];

const PAYMENT_LABELS = [
  'payment method',
  'payment',
  'fizetesi mod',
  'zahlungsart',
  'mode de paiement',
  'methode de paiement',
  'metodo de pago',
];

const SHIPPING_LABELS = [
  'shipping method',
  'delivery method',
  'szallitasi mod',
  'versandart',
  'mode de livraison',
  'metodo de envio',
];

function extractOrderNumber(text: string): string | null {
  for (const pattern of ORDER_PATTERNS) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim().replace(/[.,;:)]+$/, '');
    if (candidate && /\d/.test(candidate)) return candidate;
  }
  return null;
}

function currencyFromToken(token: string): string | null {
  const normalized = token.toUpperCase();
  if (normalized.includes('HUF') || normalized.includes('FT')) return 'HUF';
  if (normalized.includes('EUR') || normalized.includes('€')) return 'EUR';
  if (normalized.includes('USD') || normalized.includes('$')) return 'USD';
  if (normalized.includes('GBP') || normalized.includes('£')) return 'GBP';
  return null;
}

function parseMoney(raw: string, currency: string | null): number | null {
  let value = raw.trim().replace(/\s+/g, '');
  value = value.replace(/[^0-9,.-]/g, '');
  if (!value) return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.');
    else value = value.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = value.length - lastComma - 1;
    value = decimals === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const decimals = value.length - lastDot - 1;
    if (decimals !== 2 && currency === 'HUF') value = value.replace(/\./g, '');
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractLabeledMoney(text: string, labels: string[]): { amount: number; currency: string } | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`(?:^|\\n|\\b)${escaped}\\s*[:#-]?\\s*(?:([A-Z]{3}|€|\\$|£)\\s*)?([0-9][0-9 .,'’]*)(?:\\s*(Ft|HUF|EUR|USD|GBP|€|\\$|£))?`, 'i'),
      new RegExp(`(?:^|\\n|\\b)${escaped}\\s*[:#-]?\\s*([0-9][0-9 .,'’]*)\\s*(Ft|HUF|EUR|USD|GBP|€|\\$|£)`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const currencyToken = [match[1], match[3], match[2]].find((part) => part && /^(?:Ft|HUF|EUR|USD|GBP|€|\$|£)$/i.test(part));
      const numberToken = [match[2], match[1]].find((part) => part && /\d/.test(part) && !/^(?:HUF|EUR|USD|GBP)$/i.test(part));
      const currency = currencyToken ? currencyFromToken(currencyToken) : null;
      const amount = numberToken ? parseMoney(numberToken, currency) : null;
      if (amount !== null && currency) return { amount, currency };
    }
  }
  return null;
}

function extractLineAfterLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sameLine = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:#-]\\s*([^\\n]{2,120})`, 'i'));
    if (sameLine?.[1]) return sameLine[1].trim();
    const nextLine = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\n\\s*([^\\n]{2,120})`, 'i'));
    if (nextLine?.[1]) return nextLine[1].trim();
  }
  return null;
}

function detectPaymentStatus(paymentMethod: string | null, text: string): EmailExtraction['payment_status'] {
  const normalized = normalizeText(`${paymentMethod ?? ''}\n${text}`).toLowerCase();
  if (/\b(?:cash on delivery|cod|utanvet|nachnahme)\b/.test(normalized)) return 'cash_on_delivery';
  if (/\b(?:payment received|payment successful|successfully paid|sikeres fizetes|fizetes sikeres|bezahlt|paiement accepte|pago completado)\b/.test(normalized)) return 'paid';
  return 'unknown';
}

function extractSimpleProducts(text: string, fallbackCurrency: string | null): ProductExtraction[] {
  const products: ProductExtraction[] = [];
  const patterns = [
    /(?:^|\n)\s*([^\n|]{3,160}?)\s*\|\s*(?:qty|quantity|mennyiseg|menge|qte)\s*[:x]?\s*(\d+)\s*\|\s*([0-9][0-9 .,'’]*)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)\b/gi,
    /(?:^|\n)\s*([^\n]{3,160}?)\s+[x×]\s*(\d+)\s+([0-9][0-9 .,'’]*)\s*(Ft|HUF|EUR|USD|GBP|€|\$|£)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.trim();
      const quantity = Number(match[2]);
      const currency = currencyFromToken(match[4] ?? '') ?? fallbackCurrency;
      const totalPrice = parseMoney(match[3] ?? '', currency);
      if (!name || !Number.isFinite(quantity) || quantity <= 0 || totalPrice === null || !currency) continue;
      if (/^(?:subtotal|shipping|delivery|discount|total|osszesen|szallitas|kedvezmeny)\b/i.test(normalizeText(name))) continue;
      products.push({
        name,
        brand: null,
        model: null,
        variant: null,
        sku: null,
        gtin: null,
        category: null,
        quantity,
        unit_price: quantity > 0 ? Number((totalPrice / quantity).toFixed(2)) : null,
        total_price: totalPrice,
        currency,
        product_url: null,
        image_url: null,
        confidence: 0.9,
      });
    }
  }

  return products.slice(0, 50);
}

export function parseGenericOrderConfirmationEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): GenericOrderParseResult | null {
  const domains = input.senderDomains.map(normalizeDomain).filter(Boolean);
  if (
    domains.length === 0 ||
    domains.some(isCarrierSenderDomain) ||
    domains.some(isSharedPlatformSenderDomain) ||
    domains.some(isPublicMailboxSenderDomain)
  ) {
    return null;
  }

  const subject = normalizeText(input.subject ?? '');
  const body = normalizeText(input.bodyText ?? '');
  const context = `${subject}\n${body}`;
  const orderNumber = extractOrderNumber(context);
  if (!orderNumber) return null;

  const subjectSignal = SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
  const confirmationSignal = CONFIRMATION_PATTERNS.some((pattern) => pattern.test(context));
  if (!confirmationSignal) return null;

  const total = extractLabeledMoney(body, TOTAL_LABELS);
  const paymentMethod = extractLineAfterLabel(body, PAYMENT_LABELS);
  const shippingMethod = extractLineAfterLabel(body, SHIPPING_LABELS);
  const products = extractSimpleProducts(body, total?.currency ?? null);
  const orderDetailsCue = /\b(?:order details|order summary|rendeles reszletei|megrendeles adatai|bestellubersicht|details de la commande|resumen del pedido)\b/i.test(context);

  const corroborators = [
    Boolean(total),
    Boolean(paymentMethod),
    Boolean(shippingMethod),
    products.length > 0,
    orderDetailsCue,
    subjectSignal,
  ].filter(Boolean).length;

  if (corroborators < 2) return null;

  const merchant = merchantFromDomain(domains[0]!);
  const paymentStatus = detectPaymentStatus(paymentMethod, body);
  const confidence = corroborators >= 4 ? 0.97 : corroborators === 3 ? 0.95 : 0.92;

  const extraction: EmailExtraction = {
    event_type: 'order_created',
    merchant,
    merchant_legal_name: null,
    order_number: orderNumber,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: total?.amount ?? null,
    currency: total?.currency ?? null,
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    paid_amount: paymentStatus === 'paid' ? total?.amount ?? null : null,
    paid_currency: paymentStatus === 'paid' ? total?.currency ?? null : null,
    shipping_method: shippingMethod,
    tracking_number: null,
    carrier: null,
    parcel_sender: null,
    cod_amount: paymentStatus === 'cash_on_delivery' ? total?.amount ?? null : null,
    cod_currency: paymentStatus === 'cash_on_delivery' ? total?.currency ?? null : null,
    invoice_number: null,
    products,
    confidence,
  };

  return {
    extraction,
    parserVersion: PARSER_VERSION,
    reasons: [
      'generic_explicit_order_confirmation',
      'generic_labeled_order_identity',
      ...(subjectSignal ? ['generic_confirmation_subject'] : []),
      ...(total ? ['generic_labeled_total'] : []),
      ...(paymentMethod ? ['generic_payment_method'] : []),
      ...(shippingMethod ? ['generic_shipping_method'] : []),
      ...(products.length > 0 ? ['generic_product_rows'] : []),
      ...(orderDetailsCue ? ['generic_order_details_section'] : []),
    ],
  };
}