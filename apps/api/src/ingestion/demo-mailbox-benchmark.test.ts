import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';
import {
  parseDeterministicLifecycleEmail,
  type DeterministicLifecycleEvent,
} from './deterministic-lifecycle-parser.js';
import { validateEmailExtraction } from '../validation/email-extraction-validator.js';
import {
  resolvePurchaseCandidates,
  type ResolutionEvidence,
} from '../resolution/purchase-resolution.js';
import {
  resolveShipmentCandidates,
  type ShipmentPurchaseIdentity,
  type ShipmentResolutionEvidence,
} from '../resolution/shipment-resolution.js';
import { decideLifecyclePurchasePatch } from './deterministic-lifecycle-state.js';

type FixtureKind = 'must_positive' | 'must_negative' | 'probe';
type ParserRoute = 'lifecycle' | 'commerce';

interface DemoEmailFixture {
  id: string;
  journey: string;
  kind: FixtureKind;
  receivedAt: string;
  senderEmail: string;
  subject: string;
  bodyText: string;
  expectedRoute?: ParserRoute;
  expectedEventType?: string;
  expectedLifecycleEvent?: DeterministicLifecycleEvent;
  expectedOrderNumber?: string;
  expectedShipmentPhase?: string;
}

interface ParsedFixture {
  fixture: DemoEmailFixture;
  route: ParserRoute | null;
  eventType: string | null;
  lifecycleEvent: DeterministicLifecycleEvent | null;
  shipmentPhase: string | null;
  validationStatus: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  merchant: string | null;
  carrier: string | null;
  confidence: number | null;
  validatedResult: Record<string, unknown> | null;
}

const USER_ID = 'demo-mailbox-user';

function senderDomain(senderEmail: string): string {
  const at = senderEmail.lastIndexOf('@');
  return at >= 0 ? senderEmail.slice(at + 1).trim().toLowerCase() : '';
}

const fixtures: DemoEmailFixture[] = [
  {
    id: 'hu-order', journey: 'generic-hu-card', kind: 'must_positive', receivedAt: '2026-07-01T08:00:00Z',
    senderEmail: 'orders@mintasport.hu', subject: 'Rendelés visszaigazolás #BF-10001',
    bodyText: ['Köszönjük megrendelésedet', 'Rendelésszám: BF-10001', 'Rendelés részletei', 'Futózokni | Mennyiség 2 | 7 980 Ft', 'Végösszeg: 9 470 Ft', 'Fizetési mód: Bankkártya', 'Szállítási mód: GLS'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: 'BF-10001',
  },
  {
    id: 'en-order', journey: 'generic-en-card', kind: 'must_positive', receivedAt: '2026-07-02T08:00:00Z',
    senderEmail: 'orders@northstar-shop.com', subject: 'Order confirmation #NS-20002',
    bodyText: ['Thank you for your order', 'Order number: NS-20002', 'Order details', 'Travel Backpack | Qty 1 | 79.90 EUR', 'Order total: 89.90 EUR', 'Payment method: Visa', 'Shipping method: DHL'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: 'NS-20002',
  },
  {
    id: 'de-order', journey: 'generic-de-card', kind: 'must_positive', receivedAt: '2026-07-03T08:00:00Z',
    senderEmail: 'shop@bergwerk.de', subject: 'Bestellbestaetigung BW-30003',
    bodyText: ['Vielen Dank fuer Ihre Bestellung', 'Bestellnummer: BW-30003', 'Gesamtbetrag: 74,50 EUR', 'Zahlungsart: Kreditkarte', 'Versandart: DHL'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: 'BW-30003',
  },
  {
    id: 'fr-order', journey: 'generic-fr-card', kind: 'must_positive', receivedAt: '2026-07-04T08:00:00Z',
    senderEmail: 'commandes@maison-bleue.fr', subject: 'Confirmation de commande',
    bodyText: ['Merci pour votre commande', 'Numero de commande: MB-40004', 'Total de la commande: 52,00 EUR', 'Mode de paiement: Visa', 'Mode de livraison: Standard'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: 'MB-40004',
  },
  {
    id: 'es-order', journey: 'generic-es-card', kind: 'must_positive', receivedAt: '2026-07-05T08:00:00Z',
    senderEmail: 'pedidos@casa-roja.es', subject: 'Confirmacion de pedido',
    bodyText: ['Gracias por tu pedido', 'Numero de pedido: ES-50005', 'Total del pedido: 63,90 EUR', 'Metodo de pago: Mastercard', 'Metodo de envio: Standard'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: 'ES-50005',
  },
  {
    id: 'hu-cod-order', journey: 'generic-hu-cod', kind: 'must_positive', receivedAt: '2026-07-06T08:00:00Z',
    senderEmail: 'rendeles@otthonbolt.hu', subject: 'Megrendelés visszaigazolás #COD-60006',
    bodyText: ['Köszönjük a megrendelését', 'Megrendelésszám: COD-60006', 'Végösszeg: 18 990 Ft', 'Fizetési mód: Utánvét', 'Szállítási mód: Futár'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: 'COD-60006',
  },
  {
    id: 'gym-order', journey: 'gymbeam-expressone-delivered', kind: 'must_positive', receivedAt: '2026-07-07T08:00:00Z',
    senderEmail: 'shop@service.gymbeam.hu', subject: 'Rendelés visszaigazolás #3010999001',
    bodyText: ['Köszönjük megrendelésedet', 'Rendelésszám: 3010999001', 'Rendelés részletei', 'Protein shaker | Mennyiség 1 | 3 990 Ft', 'Végösszeg: 5 480 Ft', 'Fizetési mód: Bankkártya', 'Szállítási mód: Express One'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: '3010999001',
  },
  {
    id: 'gym-pre-advice', journey: 'gymbeam-expressone-delivered', kind: 'must_positive', receivedAt: '2026-07-08T08:00:00Z',
    senderEmail: 'shop@service.gymbeam.hu', subject: 'Gáborné, a megrendelésed úton van!',
    bodyText: 'A 3010999001 számú rendelésedet becsomagoltuk. Hamarosan a Express One szállító cég kezébe kerül. A 605855688145000013605231 számmal követheted a csomagot.',
    expectedRoute: 'commerce', expectedEventType: 'shipment', expectedOrderNumber: '3010999001', expectedShipmentPhase: 'shipment_created',
  },
  {
    id: 'express-transit', journey: 'gymbeam-expressone-delivered', kind: 'must_positive', receivedAt: '2026-07-09T08:00:00Z',
    senderEmail: 'ertesites@expressone.hu', subject: 'Csomagod úton van',
    bodyText: 'Tracking number: 605855688145000013605231. Küldeményed úton van a kézbesítési cím felé.',
    expectedRoute: 'commerce', expectedEventType: 'shipment',
  },
  {
    id: 'express-delivered', journey: 'gymbeam-expressone-delivered', kind: 'must_positive', receivedAt: '2026-07-10T08:00:00Z',
    senderEmail: 'ertesites@expressone.hu', subject: 'Csomag kézbesítve',
    bodyText: 'Tracking number: 605855688145000013605231. Sikeresen kézbesítettük a küldeményt.',
    expectedRoute: 'commerce', expectedEventType: 'delivery',
  },
  {
    id: 'gyerek-order', journey: 'gyerekjatekbolt-payment-failed-cancelled', kind: 'must_positive', receivedAt: '2026-07-11T08:00:00Z',
    senderEmail: 'rendeles@gyerekjatekbolt.com', subject: 'Rendelés visszaigazolás #535574',
    bodyText: ['Köszönjük a rendelésedet', 'Rendelésszám: 535574', 'Végösszeg: 14 660 Ft', 'Fizetési mód: Bankkártya', 'Szállítási mód: Futár'].join('\n'),
    expectedRoute: 'commerce', expectedEventType: 'order_created', expectedOrderNumber: '535574',
  },
  {
    id: 'gyerek-payment-failed', journey: 'gyerekjatekbolt-payment-failed-cancelled', kind: 'must_positive', receivedAt: '2026-07-11T08:10:00Z',
    senderEmail: 'fizetes@gyerekjatekbolt.com', subject: 'Sikertelen bankkártyás fizetés',
    bodyText: 'Rendelésszám: 535574. A bankkártyás fizetés nem sikerült. A tranzakció sikertelen volt.',
    expectedRoute: 'lifecycle', expectedEventType: 'order_updated', expectedLifecycleEvent: 'payment_failed', expectedOrderNumber: '535574',
  },
  {
    id: 'gyerek-cancelled', journey: 'gyerekjatekbolt-payment-failed-cancelled', kind: 'must_positive', receivedAt: '2026-07-12T08:00:00Z',
    senderEmail: 'rendeles@gyerekjatekbolt.com', subject: 'Rendelés állapot változás',
    bodyText: 'Rendelésszám: 535574. Jelenlegi állapot: Törölve.',
    expectedRoute: 'lifecycle', expectedEventType: 'order_updated', expectedLifecycleEvent: 'cancelled', expectedOrderNumber: '535574',
  },
  {
    id: 'alza-processing', journey: 'alza-box-no-tracking', kind: 'must_positive', receivedAt: '2026-07-13T08:00:00Z',
    senderEmail: 'info@alza.hu', subject: 'Már dolgozunk rajta. / 602385238 sz. megr.',
    bodyText: 'Információ a megrendelésről\nMegrendelés 602385238\n602385238 sz. megrendelésed feldolgozását megkezdtük.',
    expectedRoute: 'lifecycle', expectedEventType: 'order_updated', expectedLifecycleEvent: 'order_processing', expectedOrderNumber: '602385238',
  },
  {
    id: 'alza-delay', journey: 'alza-box-no-tracking', kind: 'must_positive', receivedAt: '2026-07-14T08:00:00Z',
    senderEmail: 'info@alza.hu', subject: '602385238 sz. megrendelésed késve érkezik',
    bodyText: 'A 602385238 számú megrendelésedet átadtuk a szállítónak. Elnézést kérünk a késésért. A kézbesítés várható új időpontja: 2026.07.15 12:00.',
    expectedRoute: 'lifecycle', expectedEventType: 'order_updated', expectedLifecycleEvent: 'delayed', expectedOrderNumber: '602385238',
  },
  {
    id: 'alza-pickup', journey: 'alza-box-no-tracking', kind: 'must_positive', receivedAt: '2026-07-15T08:00:00Z',
    senderEmail: 'info@alza.hu', subject: 'Vedd át 602385238 sz. megrendelésed',
    bodyText: 'Megrendelés 602385238\n602385238 sz. megrendelésed megérkezett a Budapest AlzaBoxba.',
    expectedRoute: 'commerce', expectedEventType: 'shipment', expectedOrderNumber: '602385238', expectedShipmentPhase: 'ready_for_pickup',
  },
  {
    id: 'szidibox-packing', journey: 'szidibox-mpl-pickup', kind: 'must_positive', receivedAt: '2026-07-16T08:00:00Z',
    senderEmail: 'szidibox@gmail.com', subject: 'Szidibox Karton Kft. Webáruház - Megrendelését összekészítettük SO-2024-77777',
    bodyText: 'kartonshop.hu\nRendelésszám: SO-2024-77777\nA rendelését összekészítettük és hamarosan átadjuk a futárszolgálat részére.',
    expectedRoute: 'lifecycle', expectedEventType: 'shipment', expectedLifecycleEvent: 'shipment_created', expectedOrderNumber: 'SO-2024-77777', expectedShipmentPhase: 'shipment_created',
  },
  {
    id: 'mpl-shipped', journey: 'szidibox-mpl-pickup', kind: 'must_positive', receivedAt: '2026-07-17T08:00:00Z',
    senderEmail: 'kozponti.ertesites@posta.hu', subject: 'Csomagot adtak fel neked',
    bodyText: 'Értesítünk, hogy csomagot adtak fel Neked. Feladó: Szidibox Karton Kft. Csomagazonosító: PB9SDEMO777770 Árufizetési összeg: 26 390 Ft',
    expectedRoute: 'lifecycle', expectedEventType: 'shipment', expectedLifecycleEvent: 'shipped', expectedShipmentPhase: 'shipped',
  },
  {
    id: 'mpl-out', journey: 'szidibox-mpl-pickup', kind: 'must_positive', receivedAt: '2026-07-18T08:00:00Z',
    senderEmail: 'kozponti.ertesites@posta.hu', subject: 'Csomagod a kézbesítőnél van',
    bodyText: 'Csomagod a kézbesítőnél van. Feladó: Szidibox Karton Kft. Csomagazonosító: PB9SDEMO777770 Árufizetési összeg: 26 390 Ft',
    expectedRoute: 'lifecycle', expectedEventType: 'shipment', expectedLifecycleEvent: 'out_for_delivery', expectedShipmentPhase: 'out_for_delivery',
  },
  {
    id: 'mpl-pickup', journey: 'szidibox-mpl-pickup', kind: 'must_positive', receivedAt: '2026-07-19T08:00:00Z',
    senderEmail: 'kozponti.ertesites@posta.hu', subject: 'Csomagod a postán átvehető',
    bodyText: 'Csomagod már átvehető az alábbi postán. Feladó: Szidibox Karton Kft. Csomagazonosító: PB9SDEMO777770 Árufizetési összeg: 26 390 Ft',
    expectedRoute: 'lifecycle', expectedEventType: 'shipment', expectedLifecycleEvent: 'ready_for_pickup', expectedShipmentPhase: 'ready_for_pickup',
  },
  {
    id: 'shopify-shared', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T08:00:00Z',
    senderEmail: 'notify@shopifyemail.com', subject: 'Order #SH-88001 confirmed',
    bodyText: 'Thanks for your order\nOrder #: SH-88001\nOrder total: 49.00 EUR\nPayment method: Visa',
  },
  {
    id: 'gmail-rich-order', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T09:00:00Z',
    senderEmail: 'randomshop@gmail.com', subject: 'Rendelés visszaigazolás - BF-GMAIL-1',
    bodyText: 'Köszönjük a rendelésedet\nRendelésszám: BF-GMAIL-1\nVégösszeg: 26 390 Ft\nFizetési mód: bankkártya',
  },
  {
    id: 'fake-gls', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T10:00:00Z',
    senderEmail: 'tracking@gls-security.example', subject: 'Csomagod úton van',
    bodyText: 'Tracking number: DEMOGLS123456789. Kattints ide a cím megerősítéséhez.',
  },
  {
    id: 'newsletter', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T11:00:00Z',
    senderEmail: 'hello@mintasport.hu', subject: 'Nyári akció -40%',
    bodyText: 'Csak ma minden futócipő akciós. Nézd meg az ajánlatainkat!',
  },
  {
    id: 'otp', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T12:00:00Z',
    senderEmail: 'security@northstar-shop.com', subject: 'Your verification code',
    bodyText: 'Your one-time verification code is 884211. It expires in 10 minutes.',
  },
  {
    id: 'disney-subscription', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T13:00:00Z',
    senderEmail: 'no-reply@disneyplus.com', subject: 'Your Disney+ subscription continues',
    bodyText: 'Your monthly subscription will renew next month. Manage your subscription in your account.',
  },
  {
    id: 'gls-survey', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T14:00:00Z',
    senderEmail: 'survey@gls-hungary.com', subject: 'Mennyire voltál elégedett a kézbesítéssel?',
    bodyText: 'Kérjük értékeld a futárszolgálatot. Köszönjük a visszajelzésed.',
  },
  {
    id: 'password-reset', journey: 'noise', kind: 'must_negative', receivedAt: '2026-07-20T15:00:00Z',
    senderEmail: 'support@otthonbolt.hu', subject: 'Jelszó visszaállítása',
    bodyText: 'A jelszavad visszaállításához használd az alábbi biztonságos linket.',
  },
  {
    id: 'mcdonalds-pos', journey: 'short-pos-probe', kind: 'probe', receivedAt: '2026-07-21T08:00:00Z',
    senderEmail: 'noreply@mcdonalds.hu', subject: 'Rendelésed összesítője - 6356',
    bodyText: 'Rendelési szám: 6356\nÉtterem: Budapest\nÖsszeg: 4 890 Ft\nEz a levél a rendelés összesítője, a nyugtát átvételkor kapod meg.',
  },
  {
    id: 'dpd-out-for-delivery', journey: 'carrier-phase-probe', kind: 'probe', receivedAt: '2026-07-21T09:00:00Z',
    senderEmail: 'info@dpd.hu', subject: 'Ma érkezik a csomagod',
    bodyText: 'Tracking number: 16380124269999. A csomag kézbesítés alatt van, a futár ma viszi ki.',
  },
  {
    id: 'weak-rich-order', journey: 'weak-order-probe', kind: 'probe', receivedAt: '2026-07-21T10:00:00Z',
    senderEmail: 'orders@unknown-demo.eu', subject: 'BF-70007',
    bodyText: 'Order number: BF-70007\nOrder total: 44.00 EUR\nPayment method: Visa\nShipping method: Standard',
  },
];

function parseFixture(fixture: DemoEmailFixture): ParsedFixture {
  const domain = senderDomain(fixture.senderEmail);
  const lifecycle = parseDeterministicLifecycleEmail({
    senderDomains: [domain],
    senderEmails: [fixture.senderEmail],
    subject: fixture.subject,
    bodyText: fixture.bodyText,
  });

  const route: ParserRoute | null = lifecycle ? 'lifecycle' : 'commerce';
  const parsed = lifecycle ?? parseDeterministicCommerceEmail({
    senderDomains: [domain],
    subject: fixture.subject,
    bodyText: fixture.bodyText,
  });

  if (!parsed) {
    return {
      fixture,
      route: null,
      eventType: null,
      lifecycleEvent: null,
      shipmentPhase: null,
      validationStatus: null,
      orderNumber: null,
      trackingNumber: null,
      merchant: null,
      carrier: null,
      confidence: null,
      validatedResult: null,
    };
  }

  const validated = validateEmailExtraction({
    extraction: parsed.extraction,
    senderDomains: [domain],
    subject: fixture.subject,
    bodyText: fixture.bodyText,
  });
  const lifecycleEvent = lifecycle?.lifecycleEvent ?? null;
  const shipmentPhase = lifecycle?.shipmentPhase ?? ('shipmentPhase' in parsed ? parsed.shipmentPhase ?? null : null);
  const validatedResult: Record<string, unknown> = {
    ...validated,
    ...(lifecycleEvent ? { lifecycle_event: lifecycleEvent } : {}),
    ...(shipmentPhase ? { shipment_phase: shipmentPhase } : {}),
  };

  return {
    fixture,
    route,
    eventType: validated.event_type,
    lifecycleEvent,
    shipmentPhase,
    validationStatus: validated.validation_status,
    orderNumber: validated.order_number,
    trackingNumber: validated.tracking_number,
    merchant: validated.merchant,
    carrier: validated.carrier,
    confidence: validated.confidence,
    validatedResult,
  };
}

function purchaseEvidence(rows: ParsedFixture[]): ResolutionEvidence[] {
  return rows.flatMap((row) => {
    const result = row.validatedResult;
    if (!result || row.validationStatus === 'review' || !row.eventType || !row.confidence) return [];
    if (!['order_created', 'order_updated', 'payment_completed', 'shipment', 'delivery', 'invoice_or_receipt', 'subscription', 'refund', 'return', 'other'].includes(row.eventType)) return [];
    return [{
      sourceEmailId: row.fixture.id,
      userId: USER_ID,
      senderDomain: senderDomain(row.fixture.senderEmail),
      eventType: row.eventType as ResolutionEvidence['eventType'],
      merchant: row.merchant,
      orderNumber: row.orderNumber,
      confidence: row.confidence,
      receivedAt: row.fixture.receivedAt,
    }];
  });
}

function shipmentEvidence(rows: ParsedFixture[]): ShipmentResolutionEvidence[] {
  return rows.flatMap((row) => {
    if (
      row.validationStatus === 'review' ||
      (row.eventType !== 'shipment' && row.eventType !== 'delivery') ||
      !row.confidence
    ) return [];
    return [{
      sourceEmailId: row.fixture.id,
      userId: USER_ID,
      senderDomain: senderDomain(row.fixture.senderEmail),
      eventType: row.eventType,
      shipmentPhase: row.shipmentPhase as ShipmentResolutionEvidence['shipmentPhase'],
      merchant: row.merchant,
      orderNumber: row.orderNumber,
      trackingNumber: row.trackingNumber,
      carrier: row.carrier,
      confidence: row.confidence,
      receivedAt: row.fixture.receivedAt,
    }];
  });
}

test('demo mailbox benchmark exercises diverse purchase journeys without unsafe false positives', () => {
  const parsed = fixtures.map(parseFixture);

  const positiveMisses: Array<Record<string, unknown>> = [];
  const negativeFalsePositives: Array<Record<string, unknown>> = [];

  for (const row of parsed) {
    const fixture = row.fixture;
    if (fixture.kind === 'must_positive') {
      const mismatches: string[] = [];
      if (!row.route) mismatches.push('not_recognized');
      if (fixture.expectedRoute && row.route !== fixture.expectedRoute) mismatches.push(`route:${row.route}`);
      if (fixture.expectedEventType && row.eventType !== fixture.expectedEventType) mismatches.push(`event:${row.eventType}`);
      if (fixture.expectedLifecycleEvent && row.lifecycleEvent !== fixture.expectedLifecycleEvent) mismatches.push(`lifecycle:${row.lifecycleEvent}`);
      if (fixture.expectedOrderNumber && row.orderNumber !== fixture.expectedOrderNumber) mismatches.push(`order:${row.orderNumber}`);
      if (fixture.expectedShipmentPhase && row.shipmentPhase !== fixture.expectedShipmentPhase) mismatches.push(`phase:${row.shipmentPhase}`);
      if (mismatches.length > 0) {
        positiveMisses.push({ id: fixture.id, journey: fixture.journey, mismatches });
      }
    } else if (fixture.kind === 'must_negative' && row.route) {
      negativeFalsePositives.push({
        id: fixture.id,
        journey: fixture.journey,
        route: row.route,
        eventType: row.eventType,
        validationStatus: row.validationStatus,
      });
    }
  }

  const pEvidence = purchaseEvidence(parsed);
  const purchaseCandidates = resolvePurchaseCandidates(pEvidence);
  const creatable = purchaseCandidates.filter((row) => row.decision === 'create_direct' || row.decision === 'create_corroborated');
  const syntheticPurchases: ShipmentPurchaseIdentity[] = creatable.map((candidate, index) => ({
    purchaseId: `demo-purchase-${index + 1}`,
    userId: candidate.userId,
    merchantDomain: candidate.senderDomain,
    orderNumber: candidate.orderNumber,
  }));
  const shipmentCandidates = resolveShipmentCandidates(syntheticPurchases, shipmentEvidence(parsed));
  const gymShipment = shipmentCandidates.find((candidate) => candidate.trackingNumber === '605855688145000013605231');

  let gyerekState = 'ordered';
  let gyerekPayment: string | null = 'pending';
  let gyerekCancelledAt: string | null = null;
  for (const id of ['gyerek-payment-failed', 'gyerek-cancelled']) {
    const source = parsed.find((row) => row.fixture.id === id);
    assert.ok(source?.lifecycleEvent, `missing lifecycle source ${id}`);
    const patch = decideLifecyclePurchasePatch({
      lifecycleEvent: source.lifecycleEvent,
      sourceReceivedAt: source.fixture.receivedAt,
      currentState: gyerekState,
      currentPaymentStatus: gyerekPayment,
      currentCancelledAt: gyerekCancelledAt,
      hasShipment: false,
      latestShipmentStatus: null,
      latestShipmentEventAt: null,
    });
    gyerekState = patch.current_state ?? gyerekState;
    gyerekPayment = patch.payment_status ?? gyerekPayment;
    gyerekCancelledAt = patch.cancelled_at ?? gyerekCancelledAt;
  }

  const packingSafetyPatch = decideLifecyclePurchasePatch({
    lifecycleEvent: 'order_packing',
    sourceReceivedAt: '2026-07-20T08:00:00Z',
    currentState: 'in_transit',
    currentPaymentStatus: 'paid',
    currentCancelledAt: null,
    hasShipment: true,
    latestShipmentStatus: 'in_transit',
    latestShipmentEventAt: '2026-07-20T09:00:00Z',
  });

  const probes = parsed.filter((row) => row.fixture.kind === 'probe').map((row) => ({
    id: row.fixture.id,
    recognized: Boolean(row.route),
    route: row.route,
    eventType: row.eventType,
    lifecycleEvent: row.lifecycleEvent,
    shipmentPhase: row.shipmentPhase,
    validationStatus: row.validationStatus,
    orderNumber: row.orderNumber,
    trackingNumber: row.trackingNumber,
  }));

  const report = {
    fixtures: fixtures.length,
    mustPositive: fixtures.filter((fixture) => fixture.kind === 'must_positive').length,
    mustPositiveRecognized: fixtures.filter((fixture) => fixture.kind === 'must_positive').length - positiveMisses.length,
    positiveMisses,
    mustNegative: fixtures.filter((fixture) => fixture.kind === 'must_negative').length,
    negativeFalsePositives,
    probes,
    purchaseCandidates: purchaseCandidates.map((candidate) => ({
      orderNumber: candidate.orderNumber,
      senderDomain: candidate.senderDomain,
      decision: candidate.decision,
      evidenceCount: candidate.evidenceCount,
      confidence: candidate.confidence,
    })),
    creatablePurchases: creatable.length,
    shipmentCandidates: shipmentCandidates.map((candidate) => ({
      trackingNumber: candidate.trackingNumber,
      carrierSlug: candidate.carrierSlug,
      decision: candidate.decision,
      recommendedStatus: candidate.recommendedStatus,
      evidenceCount: candidate.evidenceCount,
      merchantAnchorCount: candidate.merchantAnchorCount,
      carrierEvidenceCount: candidate.carrierEvidenceCount,
    })),
    gymbeamExpressOne: gymShipment ? {
      decision: gymShipment.decision,
      recommendedStatus: gymShipment.recommendedStatus,
      carrierSlug: gymShipment.carrierSlug,
      evidenceCount: gymShipment.evidenceCount,
    } : null,
    gyerekjatekboltFinal: {
      state: gyerekState,
      paymentStatus: gyerekPayment,
      cancelledAt: gyerekCancelledAt,
    },
    packingDoesNotDowngradePhysicalShipment: Object.keys(packingSafetyPatch).length === 0,
  };

  console.log(`DEMO_MAILBOX_BENCHMARK ${JSON.stringify(report)}`);

  assert.deepEqual(positiveMisses, []);
  assert.deepEqual(negativeFalsePositives, []);
  assert.ok(creatable.length >= 8, 'expected at least eight independently creatable purchase journeys');
  assert.ok(gymShipment, 'expected GymBeam/Express One shipment candidate');
  assert.equal(gymShipment.decision, 'linkable');
  assert.equal(gymShipment.recommendedStatus, 'delivered');
  assert.equal(gymShipment.carrierSlug, 'express-one');
  assert.equal(gyerekState, 'cancelled');
  assert.equal(gyerekPayment, 'failed');
  assert.ok(gyerekCancelledAt);
  assert.deepEqual(packingSafetyPatch, {});

  const mplPickup = parsed.find((row) => row.fixture.id === 'mpl-pickup');
  assert.equal(mplPickup?.shipmentPhase, 'ready_for_pickup');
  assert.notEqual(mplPickup?.eventType, 'delivery');

  const szidiboxPacking = parsed.find((row) => row.fixture.id === 'szidibox-packing');
  assert.equal(szidiboxPacking?.shipmentPhase, 'shipment_created');
  assert.notEqual(szidiboxPacking?.shipmentPhase, 'shipped');
});
