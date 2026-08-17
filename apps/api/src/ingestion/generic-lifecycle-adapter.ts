import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import { identifyMerchantSender, isCarrierSenderDomain } from '../email/sender-role.js';
import {
  isPublicMailboxSenderDomain,
  isSharedPlatformSenderDomain,
  stripQuotedHistoryForGenericOrder,
} from './generic-order-confirmation-adapter.js';

export const GENERIC_LIFECYCLE_PARSER_VERSION = 'generic-lifecycle-v1.2';

export type GenericLifecycleEvent = 'shipment' | 'delivery' | 'invoice_or_receipt';
export type GenericLifecycleShipmentPhase =
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'ready_for_pickup'
  | 'delivered';

export interface GenericLifecycleParseResult {
  extraction: EmailExtraction;
  parserVersion: string;
  reasons: string[];
  shipmentPhase?: GenericLifecycleShipmentPhase;
  senderDomain: string;
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

/**
 * Shared transactional infrastructure can carry a merchant-branded lifecycle
 * email without being the merchant itself. It is useful evidence for a
 * dedicated provider/platform adapter, but it must never become generic
 * merchant identity.
 *
 * Keep this list evidence-driven. Every entry below is backed by either an
 * observed real recipient email or existing BuyFlow provider/platform research.
 */
const NON_MERCHANT_INFRASTRUCTURE_DOMAINS = [
  'chameleoon.sk',
  'szamlazz.hu',
  'billingo.hu',
  'myshoprenter.hu',
] as const;

function isNonMerchantInfrastructureSenderDomain(domain: string): boolean {
  return NON_MERCHANT_INFRASTRUCTURE_DOMAINS.some((provider) => domainMatches(domain, provider));
}

function merchantFromDomain(domain: string): string {
  const labels = normalizeDomain(domain).split('.').filter(Boolean);
  const root = labels.length >= 2 ? labels[labels.length - 2]! : (labels[0] ?? domain);
  return root
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ') || domain;
}

function safeSenderDomain(domains: string[]): string | null {
  const normalized = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
  if (normalized.length !== 1) return null;
  const domain = normalized[0]!;
  if (
    isCarrierSenderDomain(domain)
    || isSharedPlatformSenderDomain(domain)
    || isPublicMailboxSenderDomain(domain)
    || isNonMerchantInfrastructureSenderDomain(domain)
    || identifyMerchantSender([domain]) !== null
  ) return null;
  return domain;
}

const ORDER_PATTERNS = [
  /\border\s*(?:number|no\.?|id)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\border\s*#\s*([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:rendeles(?:szam|\s+szama|\s+azonosito)|megrendeles(?:szam|\s+szama|\s+azonosito))\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:a\s+)?(?:rendeles|megrendeles)\s*#\s*([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /#([a-z0-9][a-z0-9._/-]{3,39})\s+szamu\s+(?:rendeleshez|megrendeleshez)\b/i,
  /\b(?:a\s+)?([a-z0-9][a-z0-9._/-]{3,39})\s+(?:szamu\s+)?(?:rendelest|megrendelest|rendelesedet|megrendelesedet)\b/i,
  /^([a-z]{1,8}\d{4,20})\s*-\s*(?:rendelesed|megrendelesed)\b/im,
  /\b(?:bestellnummer|bestellnr\.?|auftragsnummer)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
  /\b(?:numero de commande|commande n[°o]?|numero de pedido|pedido n[°o]?)\s*[:#-]?\s*#?([a-z0-9][a-z0-9._/-]{3,39})\b/i,
] as const;

const TRACKING_PATTERNS = [
  /\b(?:tracking(?:\s*(?:number|no\.?|id))?|nyomkovetesi\s*(?:szam|azonosito)|csomag(?:szam|azonosito)|kuldemeny(?:szam|azonosito)|parcel(?:\s*(?:number|no\.?|id))|shipment(?:\s*(?:number|no\.?|id)))\s*[:#-]?\s*([a-z0-9][a-z0-9-]{7,39})\b/i,
] as const;

const INVOICE_PATTERNS = [
  /\b(?:szamla(?:szam|\s+sorszama)?|invoice\s*(?:number|no\.?))\s*[:#-]?\s*([a-z0-9][a-z0-9./_-]{3,39})\b/i,
  /^\s*szamla\s+([a-z0-9][a-z0-9./_-]{3,39})(?:\s|-|$)/im,
  /\binvoice\s+([a-z0-9][a-z0-9./_-]{3,39})(?:\s|$)/i,
] as const;

function extractFirst(text: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim().replace(/[.,;:)]+$/, '');
    if (value && /\d/.test(value)) return value;
  }
  return null;
}

function baseExtraction(input: {
  eventType: GenericLifecycleEvent;
  merchant: string;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  invoiceNumber?: string | null;
  confidence: number;
}): EmailExtraction {
  return {
    event_type: input.eventType,
    merchant: input.merchant,
    merchant_legal_name: null,
    order_number: input.orderNumber ?? null,
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
    tracking_number: input.trackingNumber ?? null,
    carrier: null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: input.invoiceNumber ?? null,
    products: [],
    confidence: input.confidence,
  };
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Lifecycle words inside explanatory/future instructions are not evidence that
 * the state is true now. Real reviewed examples include:
 * - "ertesitunk, amint rendelesed atveheto"
 * - "e-mailben kuldjuk, mikor a rendeleset atadtuk a futarszolgalatnak"
 * - "miutan kaptal ertesitest, hogy a rendelesed atveheto"
 *
 * Keep this narrow: remove only the sentence carrying the future reporting or
 * prerequisite construction. Order/tracking identities are still extracted
 * from the full fresh message, and an independent current-state sentence
 * remains usable.
 */
const FUTURE_CONDITIONAL_LIFECYCLE_STATEMENT_PATTERNS = [
  /\b(?:tovabbi\s+e-?mailben\s+)?ertesit(?:unk|juk)[^.!?\n]{0,180}\b(?:amint|amikor|mikor)\b/i,
  /\b(?:e-?mailben\s+)?(?:kuldjuk|kuldeni\s+fogjuk|kuldunk)[^.!?\n]{0,180}\b(?:amint|amikor|mikor)\b/i,
  /\bmiutan\b[^.!?\n]{0,120}\b(?:kaptal|kapott|kapsz|kapja|kap)\b[^.!?\n]{0,120}\bertesitest\b[^.!?\n]{0,160}\batveheto\b/i,
  /\bcsak\s+akkor\b[^.!?\n]{0,220}\bmiutan\b[^.!?\n]{0,220}\bertesitest\b[^.!?\n]{0,160}\batveheto\b/i,
  /\bwe(?:'ll|\s+will)\s+(?:notify|email|send)[^.!?\n]{0,180}\b(?:when|once|as\s+soon\s+as)\b/i,
  /\byou(?:'ll|\s+will)\s+(?:be\s+notified|receive)[^.!?\n]{0,180}\b(?:when|once|as\s+soon\s+as)\b/i,
] as const;

function currentLifecycleEvidenceText(subject: string, body: string): string {
  const currentBody = body
    .split(/\n+|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !hasAny(segment, FUTURE_CONDITIONAL_LIFECYCLE_STATEMENT_PATTERNS))
    .join('\n');
  return `${subject}\n${currentBody}`.trim();
}

const DELIVERED_PATTERNS = [
  /\b(?:rendelesed|megrendelesed|csomagod) (?:sikeresen )?kezbesitve\b/i,
  /\b(?:rendelesedet|megrendelesedet|rendeleset|megrendeleset|csomagodat) (?:sikeresen )?kezbesitett(?:uk|ek)\b/i,
  /\b(?:your )?(?:order|package) (?:has been |was )?delivered\b/i,
  /\bdelivered successfully\b/i,
] as const;

const READY_FOR_PICKUP_PATTERNS = [
  /\b(?:rendelesed|megrendelesed|csomagod) (?:mar )?atveheto\b/i,
  /\batveheto (?:az|a) (?:uzletben|atvevohelyen|automataban|csomagautomataban|ponton)\b/i,
  /\b(?:your )?(?:order|package) is ready for (?:collection|pickup)\b/i,
  /\bready for (?:collection|pickup)\b/i,
] as const;

const OUT_FOR_DELIVERY_PATTERNS = [
  /\b(?:rendelesed|megrendelesed|csomagod) (?:mar )?(?:a )?kezbesitonel van\b/i,
  /\b(?:ma|a mai napon) kezbesit(?:juk|ik) (?:a )?(?:rendelesedet|megrendelesedet|rendeleset|megrendeleset|csomagodat)\b/i,
  /\b(?:your )?(?:order|package) is out for delivery\b/i,
  /\bout for delivery\b/i,
] as const;

const EXPLICIT_SHIPPED_PATTERNS = [
  /\b(?:rendelesedet|megrendelesedet|rendeleset|megrendeleset|csomagodat|rendelt csomagot) [^\n.]{0,80}\b(?:feladtuk|elkuld(?:tuk|tek))\b/i,
  /\b(?:rendelesedet|megrendelesedet|rendeleset|megrendeleset|csomagodat) [^\n.]{0,100}\batadtuk [^\n.]{0,60}\b(?:futarnak|futarszolgalatnak|szallitonak)\b/i,
  /\b(?:your )?(?:order|package) (?:has been |was )?shipped\b/i,
  /\bwe (?:have )?shipped (?:your )?(?:order|package)\b/i,
] as const;

const PACKAGE_IN_TRANSIT_PATTERNS = [
  /\b(?:csomagod|csomagja) (?:mar )?uton van\b/i,
  /\b(?:your )?package is on (?:its|the) way\b/i,
  /\b(?:your )?package is in transit\b/i,
] as const;

const ORDER_IN_TRANSIT_PATTERNS = [
  /\b(?:rendelesed|megrendelesed|rendelese|megrendelese) (?:mar )?uton van\b/i,
  /\b(?:your )?order is on (?:its|the) way\b/i,
  /\b(?:your )?order is in transit\b/i,
] as const;

const PHYSICAL_FULFILLMENT_CONTEXT_PATTERNS = [
  /\bcsomag(?:od|ja|odat|jat|ok|ot)?\b/i,
  /\bfutar(?:nak|szolgalat(?:nak)?)?\b/i,
  /\bkuldemeny(?:ed|e|szam|azonosito|\s+azonositoja)?\b/i,
  /\bnyomkovet/i,
  /\btracking\b/i,
  /\bparcel\b/i,
  /\bshipment\b/i,
  /\bcourier\b/i,
  /\bcarrier\b/i,
] as const;

const INVOICE_SIGNAL_PATTERNS = [
  /\b(?:rendelesedhez|megrendelesedhez|rendeleshez|megrendeleshez) tartozo szamla\b/i,
  /\bszamlad (?:elkeszult|kiallitottuk)\b/i,
  /\belektronikus szamla(?:d)? [^\n.]{0,80}\b(?:kiallitva|kiallitottuk|kerult kiallit(?:asra|va))\b/i,
  /\binvoice (?:for|for your) (?:order|purchase)\b/i,
  /\byour invoice (?:is ready|has been issued)\b/i,
] as const;

export function parseGenericLifecycleEmail(input: {
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}): GenericLifecycleParseResult | null {
  const senderDomain = safeSenderDomain(input.senderDomains);
  if (!senderDomain) return null;

  const subject = normalizeText(input.subject ?? '');
  const freshBody = stripQuotedHistoryForGenericOrder(normalizeText(input.bodyText ?? ''));
  const context = `${subject}\n${freshBody}`.trim();
  if (!context) return null;

  const orderNumber = extractFirst(context, ORDER_PATTERNS);
  const trackingNumber = extractFirst(context, TRACKING_PATTERNS)?.toUpperCase() ?? null;
  const invoiceNumber = extractFirst(context, INVOICE_PATTERNS);
  const merchant = merchantFromDomain(senderDomain);
  const evidenceContext = currentLifecycleEvidenceText(subject, freshBody);

  if (orderNumber && hasAny(evidenceContext, INVOICE_SIGNAL_PATTERNS)) {
    return {
      extraction: baseExtraction({
        eventType: 'invoice_or_receipt',
        merchant,
        orderNumber,
        invoiceNumber,
        confidence: invoiceNumber ? 0.95 : 0.93,
      }),
      parserVersion: GENERIC_LIFECYCLE_PARSER_VERSION,
      senderDomain,
      reasons: [
        'merchant_owned_sender_domain',
        'explicit_order_identity',
        'explicit_invoice_for_order_signal',
        ...(invoiceNumber ? ['explicit_invoice_identity'] : []),
      ],
    };
  }

  if (!orderNumber && !trackingNumber) return null;

  let shipmentPhase: GenericLifecycleShipmentPhase | null = null;
  let reason = '';
  let eventType: GenericLifecycleEvent = 'shipment';

  if (hasAny(evidenceContext, DELIVERED_PATTERNS)) {
    shipmentPhase = 'delivered';
    eventType = 'delivery';
    reason = 'explicit_delivery_signal';
  } else if (hasAny(evidenceContext, READY_FOR_PICKUP_PATTERNS)) {
    shipmentPhase = 'ready_for_pickup';
    reason = 'explicit_ready_for_pickup_signal';
  } else if (hasAny(evidenceContext, OUT_FOR_DELIVERY_PATTERNS)) {
    shipmentPhase = 'out_for_delivery';
    reason = 'explicit_out_for_delivery_signal';
  } else if (hasAny(evidenceContext, EXPLICIT_SHIPPED_PATTERNS)) {
    shipmentPhase = 'shipped';
    reason = 'explicit_physical_shipment_signal';
  } else if (
    hasAny(evidenceContext, PACKAGE_IN_TRANSIT_PATTERNS)
    || (
      hasAny(evidenceContext, ORDER_IN_TRANSIT_PATTERNS)
      && hasAny(evidenceContext, PHYSICAL_FULFILLMENT_CONTEXT_PATTERNS)
    )
  ) {
    shipmentPhase = 'in_transit';
    reason = 'explicit_in_transit_signal';
  }

  if (!shipmentPhase) return null;

  return {
    extraction: baseExtraction({
      eventType,
      merchant,
      orderNumber,
      trackingNumber,
      confidence: orderNumber && trackingNumber ? 0.96 : 0.93,
    }),
    parserVersion: GENERIC_LIFECYCLE_PARSER_VERSION,
    shipmentPhase,
    senderDomain,
    reasons: [
      'merchant_owned_sender_domain',
      reason,
      ...(orderNumber ? ['explicit_order_identity'] : []),
      ...(trackingNumber ? ['explicit_tracking_identity'] : []),
      'generic_lifecycle_link_only',
    ],
  };
}
