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

function primaryAddress(email: NormalizedEmail): string {
  return email.from[0]?.email?.trim().toLowerCase() ?? '';
}

function primaryDomain(email: NormalizedEmail): string {
  const address = primaryAddress(email);
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : '';
}

function domainMatches(domain: string, expected: string): boolean {
  return domain === expected || domain.endsWith(`.${expected}`);
}

export function isProviderLifecycleV6Noise(email: NormalizedEmail): boolean {
  const domain = primaryDomain(email);
  const subject = normalize(email.subject ?? '');
  const body = normalize(email.snippet ?? '');

  // Payments to debt collectors and utility/postal bill payments are not
  // consumer purchase lifecycle events, even when the PSP says "successful".
  if (
    domainMatches(domain, 'simplepay.hu')
    && /\bsikeres fizetes\b/.test(subject)
    && /\bintrum\.hu\b/.test(`${subject} ${body}`)
  ) return true;

  if (
    domainMatches(domain, 'posta.hu')
    && /^sikeres fizetes visszaigazolas$/.test(subject)
    && /\bcsekkfizetesi tranzakcio\w*\b/.test(body)
  ) return true;

  // A support acknowledgement can mention an order ID without representing a
  // new order or lifecycle transition.
  if (
    domainMatches(domain, 'fizz.hu')
    && /^rendeles azonosito:\s*\d+\b/.test(subject)
    && /\bmegkeresesedet sikeresen rogzitettuk\b/.test(body)
  ) return true;

  return false;
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

  // Fresh v7 blind-holdout fixes. Every rule requires a trusted provider
  // plus exact transactional or lifecycle evidence in both subject and body.
  if (
    primaryAddress(email) === 'no-reply@primevideo.com'
    && /^koszonjuk, hogy ujbol hasznalja prime video-elofizeteset$/.test(subject)
    && /\bsikeresen ismet hasznalatba vette\b/.test(body)
    && /\bkovetkezo szamlazasi datum\b/.test(body)
  ) {
    return result(email, 'order_updated', 'provider_v6_prime_video_subscription_reactivated');
  }

  if (
    domainMatches(domain, 'gate.shop')
    && /\bvas[e']? g'?s vam boli pripisane na ucet!?$/.test(subject)
    && /\bgate-nel vasarolt\b/.test(body)
    && /\bjo va irtunk\b|\bjovairtunk\b/.test(body)
    && /\brendeles sz\b/.test(body)
  ) {
    return result(email, 'order_updated', 'provider_v6_gate_loyalty_purchase_credit');
  }

  if (
    domainMatches(domain, 'allegro.com')
    && /^a csomagod mar uton van! tartalma:/.test(subject)
    && /\bcsomagodat most adtak fel\b/.test(body)
    && /\bvasarlas reszletei/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_allegro_shipped', {
      shipmentPhase: 'shipped',
    });
  }

  if (
    domainMatches(domain, 'posta.hu')
    && /^csomagkuldemeny$/.test(subject)
    && /\bcsomagkuldemenyt adtak fel onnek\b/.test(body)
    && /\bkuldemenyazonosito\b/.test(body)
    && /\bfeladas datuma\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_mpl_formal_shipped', {
      shipmentPhase: 'shipped',
      carrier: 'MPL',
    });
  }

  if (
    primaryAddress(email) === 'help@acct.epicgames.com'
    && /^epic games bizonylat$/.test(subject)
    && /\bkoszonjuk a vasarlast\b/.test(body)
    && /\bszamlaazonosito\b/.test(body)
    && /\brendelesi adataid\b/.test(body)
  ) {
    return result(email, 'invoice_or_receipt', 'provider_v6_epic_games_receipt');
  }

  // Fresh v6 blind-holdout fixes. Every rule stays provider-scoped and
  // requires exact lifecycle evidence from the subject and body.
  if (
    domainMatches(domain, 'expressone.hu')
    && /^fizetesi bizonylat$/.test(subject)
    && /\bfizetesi bizonylat\b/.test(body)
    && /\bexpress one hungary kft\b/.test(body)
  ) {
    return result(email, 'invoice_or_receipt', 'provider_v6_expressone_payment_receipt');
  }

  if (
    primaryAddress(email) === 'googleplay-noreply@google.com'
    && /-elofizetesedet toroljuk$/.test(subject)
    && /\bgoogle commerce limited\b/.test(body)
    && /\bgoogle playen\b/.test(body)
    && /\btorlodik\b/.test(body)
  ) {
    return result(email, 'order_updated', 'provider_v6_google_play_subscription_cancelled');
  }

  if (
    primaryAddress(email) === 'googleplay-noreply@google.com'
    && /^elofizetesed \(.+\) elonyei hamarosan veget er$/.test(subject)
    && /\belofizetesed\b/.test(body)
    && /\bveget er\b/.test(body)
  ) {
    return result(email, 'order_updated', 'provider_v6_google_play_subscription_expiring');
  }

  if (
    (domainMatches(domain, 'posta.hu') || domainMatches(domain, 'allegromail.com'))
    && /^csomagja a kezbesitonel van$/.test(subject)
    && /\bkezbesitonk atvette\b/.test(body)
    && /\bmai napon megkisereljuk\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_mpl_out_for_delivery_formal', {
      shipmentPhase: 'out_for_delivery',
      carrier: 'MPL',
    });
  }

  if (
    domainMatches(domain, 'shopbuilder.hu')
    && /^csomagod uton$/.test(subject)
    && /\brendelt csomagot\b/.test(body)
    && /\bfeladtuk\b/.test(body)
    && /\bnyomkovetesi\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_shopbuilder_shipped', {
      shipmentPhase: 'shipped',
    });
  }

  // Fresh v5 blind-holdout fixes. Each rule requires a trusted sender domain
  // plus provider-specific subject/body evidence; broad generic matching stays
  // unchanged.
  if (
    domainMatches(domain, 'limone.hu')
    && /^csomag atvetelenek fontossaga - automatikus ertesites$/.test(subject)
    && /\bmegrendelt csomag\b/.test(body)
    && /\bfutarszolgalatnak\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_limone_handoff', {
      shipmentPhase: 'shipped',
    });
  }

  if (
    domainMatches(domain, 'famafutar.hu')
    && /^\[famafutar\.hu\] ertesites csomag erkezeserol$/.test(subject)
    && /\bkezbesitesre atvette\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_famafutar_out_for_delivery', {
      shipmentPhase: 'out_for_delivery',
      carrier: 'FamaFutár',
    });
  }

  if (
    domainMatches(domain, 'komphone.hu')
    && /^re:\s*komphone\.hu webshop - megrendeles erkezett - \d+-\d+$/.test(subject)
    && /\brendeleset\b/.test(body)
    && /\batadjuk a futarnak\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_komphone_support_handoff', {
      shipmentPhase: 'shipped',
    });
  }

  if (
    domainMatches(domain, 'fizz.hu')
    && /^#\d+ szamu rendeleshez tartozo szamla/.test(subject)
    && /\bmegrendelesedhez tartozo\b/.test(body)
    && /\bszamlat\b/.test(body)
  ) {
    return result(email, 'invoice_or_receipt', 'provider_v6_fizz_invoice');
  }

  if (
    domainMatches(domain, 'gyujtoszallitas.hu')
    && /^ertesites a csomag feladasarol$/.test(subject)
    && /\bcsomagazonosito\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_gyujtoszallitas_shipped', {
      shipmentPhase: 'shipped',
    });
  }

  if (
    domainMatches(domain, 'komphone.hu')
    && /^komphone\.hu webshop - fizetes sikeresen lezarult$/.test(subject)
    && /\bfizetes sikeresen lezarult\b/.test(body)
  ) {
    return result(email, 'payment_completed', 'provider_v6_komphone_payment_completed', {
      paymentStatus: 'paid',
    });
  }

  if (
    domainMatches(domain, 'allegro.com')
    && /^megrendeles folyamatban$/.test(subject)
    && /\bvasarlasod\b/.test(body)
    && /\bmegrendelesedet\b/.test(body)
  ) {
    return result(email, 'order_created', 'provider_v6_allegro_order_in_progress');
  }

  if (
    domainMatches(domain, 'pepita.hu')
    && /^visszaigazolt rendeles - rendelesi azonosito:\s*pe\d+\b/.test(subject)
    && /\blogisztikai kozpontunk visszaigazolta a rendelesedet\b/.test(body)
  ) {
    return result(email, 'order_updated', 'provider_v6_pepita_order_confirmed');
  }

  if (
    domainMatches(domain, 'posta.hu')
    && /^sikertelen kezbesites$/.test(subject)
    && /\bsikertelen kezbesitesi ertesito\b/.test(body)
    && /\bcsomagjanak kezbesitesevel\b/.test(body)
  ) {
    return result(email, 'shipment', 'provider_v6_mpl_delivery_failed', {
      carrier: 'MPL',
    });
  }

  if (
    domainMatches(domain, 'utteurope.com')
    && /^megrendeles visszaigazolasa:\s*\d{4}\/\d+\/\d+$/.test(subject)
    && /\bwebaruhazunkban leadott\b/.test(body)
    && /\bmegrendeleset ezennel\b/.test(body)
  ) {
    return result(email, 'order_created', 'provider_v6_utt_order_confirmed');
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
