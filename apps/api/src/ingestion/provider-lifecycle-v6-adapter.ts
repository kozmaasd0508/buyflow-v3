import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import type { DeterministicCommerceParseResult, DeterministicShipmentPhase } from './deterministic-commerce-parser.js';
import { buildEmailDocumentV1 } from './email-document.js';

export const PROVIDER_LIFECYCLE_V6_VERSION = 'provider-lifecycle-v6-shadow';

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function primaryDomain(email: NormalizedEmail): string {
  const address = email.from[0]?.email?.trim().toLowerCase() ?? '';
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

function domainMatches(domain: string, expected: string): boolean {
  return domain === expected || domain.endsWith(`.${expected}`);
}

function baseExtraction(email: NormalizedEmail, eventType: EmailExtraction['event_type']): EmailExtraction {
  const document = buildEmailDocumentV1(email);
  return {
    event_type: eventType,
    merchant: document.sender.primaryName ?? document.sender.primaryDomain,
    merchant_legal_name: null,
    order_number: document.signals.orderNumbers[0] ?? null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: document.signals.paymentMethods[0] ?? null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: document.signals.shippingMethods[0] ?? null,
    tracking_number: document.signals.trackingNumbers[0] ?? null,
    carrier: document.signals.couriers[0] ?? null,
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.96,
  };
}

function result(
  email: NormalizedEmail,
  eventType: EmailExtraction['event_type'],
  reason: string,
  options?: {
    shipmentPhase?: DeterministicShipmentPhase;
    carrier?: string;
    paymentStatus?: EmailExtraction['payment_status'];
  },
): DeterministicCommerceParseResult {
  const extraction = baseExtraction(email, eventType);
  if (options?.carrier) extraction.carrier = options.carrier;
  if (options?.paymentStatus) extraction.payment_status = options.paymentStatus;
  return {
    extraction,
    parserVersion: PROVIDER_LIFECYCLE_V6_VERSION,
    reasons: [reason, `sender_domain:${primaryDomain(email)}`],
    ...(options?.shipmentPhase ? { shipmentPhase: options.shipmentPhase } : {}),
  };
}

export function parseProviderLifecycleV6(email: NormalizedEmail): DeterministicCommerceParseResult | null {
  const domain = primaryDomain(email);
  const subject = normalize(email.subject ?? '');
  const body = normalize(email.snippet ?? '');

  // Semantic safety: a failed transaction is never a completed payment.
  if (/\b(?:tranzakcio|fizetes)\b.{0,60}\b(?:sikertelen|elutasitott|meghiusult)\b/.test(subject)) {
    return result(email, 'order_updated', 'provider_v6_payment_failed', {
      paymentStatus: 'failed',
    });
  }

  // Narrow support/reply exception. A reply is lifecycle evidence only when all
  // three anchors are present: trusted GymBeam support domain, an order-like
  // numeric identifier in the subject, and explicit delivery-delay wording in
  // the message body. This path is shipment-only and remains shadow-gated, so
  // it must never be used as evidence to create a new purchase.
  if (
    domainMatches(domain, 'gymbeam.hu')
    && /^re:\s*/.test(subject)
    && /\b\d{8,}\b/.test(subject)
    && /\b(?:csomag\w*|kezbesites\w*)\b/.test(body)
    && /\b(?:csuszas\w*|keses\w*|kesik|kesedelmes\w*|logisztikai ok)\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_support_delivery_delay', {
      shipmentPhase: 'in_transit',
      carrier: /express one/.test(body) ? 'Express One' : undefined,
    });
  }

  if (domainMatches(domain, 'foxpost.hu')) {
    if (/^csomagod megerkezett\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_foxpost_ready_for_pickup', {
        shipmentPhase: 'ready_for_pickup',
        carrier: 'Foxpost',
      });
    }
    if (/^csomagod mar a raktarunkban van\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_foxpost_in_transit', {
        shipmentPhase: 'in_transit',
        carrier: 'Foxpost',
      });
    }
    if (/^at nem vett csomagodat visszaszallitottuk\b/.test(subject)) {
      return result(email, 'return', 'provider_v6_foxpost_return_to_sender', {
        carrier: 'Foxpost',
      });
    }
  }

  if (domainMatches(domain, 'posta.hu')) {
    if (/^csomagod a postan atveheto\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_mpl_ready_for_pickup', {
        shipmentPhase: 'ready_for_pickup',
        carrier: 'MPL',
      });
    }
    if (/^csomagod a kezbesitonel van\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_mpl_out_for_delivery', {
        shipmentPhase: 'out_for_delivery',
        carrier: 'MPL',
      });
    }
    if (/^csomagot adtak fel neked\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_mpl_shipped', {
        shipmentPhase: 'shipped',
        carrier: 'MPL',
      });
    }
  }

  if (domainMatches(domain, 'packeta.hu') || domainMatches(domain, 'packeta.com')) {
    if (/^a szallitmanyt elfogadtak a szallitasra\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_packeta_accepted_for_transport', {
        shipmentPhase: 'shipped',
        carrier: 'Packeta',
      });
    }
  }

  if (domainMatches(domain, 'gate.shop')) {
    if (/^megrendelesenek elkuldese\b/.test(subject)) {
      return result(email, 'shipment', 'provider_v6_gate_order_shipped', {
        shipmentPhase: 'shipped',
      });
    }
    if (/^koszonjuk,? hogy a gate-nel vasarolt\.?$/.test(subject)) {
      return result(email, 'order_created', 'provider_v6_gate_order_created');
    }
  }

  return null;
}
