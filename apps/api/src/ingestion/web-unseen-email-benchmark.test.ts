import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';
import { parseDeterministicLifecycleEmail } from './deterministic-lifecycle-parser.js';

// Synthetic fixtures derived from publicly documented notification *types* and semantics,
// not copied customer emails. Sources used for the corpus include official Shopify and
// WooCommerce documentation for order, shipping, pickup, return, refund and payment emails.
// The purpose is to probe patterns that were not present in the original BuyFlow demo mailbox.

type Fixture = {
  id: string;
  family: 'shopify-like' | 'woocommerce-like' | 'carrier' | 'noise';
  senderEmail: string;
  subject: string;
  bodyText: string;
  mustRecognize?: boolean;
  mustHold?: boolean;
  notOrderCreation?: boolean;
  notDelivered?: boolean;
};

type Observation = {
  id: string;
  family: Fixture['family'];
  recognized: boolean;
  route: 'lifecycle' | 'commerce' | null;
  eventType: string | null;
  lifecycleEvent: string | null;
  shipmentPhase: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
};

function senderDomain(senderEmail: string): string {
  return senderEmail.slice(senderEmail.lastIndexOf('@') + 1).trim().toLowerCase();
}

const fixtures: Fixture[] = [
  {
    id: 'shopify-order-edited', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Your order #WB-71001 was updated',
    bodyText: 'We updated items in order #WB-71001. New total: 72.90 EUR. No new order was placed.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-order-cancelled', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Order #WB-71001 canceled',
    bodyText: 'Order #WB-71001 has been canceled. Any captured payment will be handled separately.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-partial-refund', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Partial refund for order #WB-71001',
    bodyText: 'A partial refund of 18.00 EUR was issued for order #WB-71001. One item remains on the order.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-shipping-confirmation', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Order #WB-71001 has shipped',
    bodyText: 'Your shipment is on the way. Tracking number: 00340434161094000001. Carrier: DHL.',
    notOrderCreation: true,
    notDelivered: true,
  },
  {
    id: 'shopify-shipping-update', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Shipping update for order #WB-71001',
    bodyText: 'Tracking information was updated. New tracking number: 00340434161094000002. Carrier: DHL.',
    notOrderCreation: true,
    notDelivered: true,
  },
  {
    id: 'shopify-ready-local-pickup', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Order #WB-71002 is ready for pickup',
    bodyText: 'Your order #WB-71002 is ready for pickup at our Budapest store. Bring your pickup confirmation.',
    notOrderCreation: true,
    notDelivered: true,
  },
  {
    id: 'shopify-picked-up', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Order #WB-71002 was picked up',
    bodyText: 'Order #WB-71002 was collected from our Budapest store. Thank you for shopping with us.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-return-created', family: 'shopify-like', senderEmail: 'returns@wildberry-demo.com',
    subject: 'Return created for order #WB-71001',
    bodyText: 'We created a return for order #WB-71001. Items to return: Trail shoes. Follow the return instructions.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-return-approved', family: 'shopify-like', senderEmail: 'returns@wildberry-demo.com',
    subject: 'Return request approved for order #WB-71001',
    bodyText: 'Your return request for order #WB-71001 was approved. A return shipping label will be provided.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-exchange-balance-due', family: 'shopify-like', senderEmail: 'returns@wildberry-demo.com',
    subject: 'Action required for exchange on order #WB-71001',
    bodyText: 'Your exchange has an outstanding balance of 12.00 EUR. Pay the remaining balance to continue the exchange.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-pending-payment-success', family: 'shopify-like', senderEmail: 'orders@wildberry-demo.com',
    subject: 'Payment received for order #WB-71003',
    bodyText: 'Payment was received successfully for existing order #WB-71003. The order can now continue processing.',
    notOrderCreation: true,
  },
  {
    id: 'shopify-pos-receipt-short-id', family: 'shopify-like', senderEmail: 'receipts@wildberry-demo.com',
    subject: 'Your store receipt',
    bodyText: 'Receipt 4821. Total 14.90 EUR. Visa ending 4242. Thank you for your in-store purchase.',
    mustHold: true,
    notOrderCreation: true,
  },
  {
    id: 'woo-failed-payment', family: 'woocommerce-like', senderEmail: 'orders@oak-demo.shop',
    subject: 'Payment failed for order #WC-88001',
    bodyText: 'Payment for order #WC-88001 was unsuccessful. Please try another payment method.',
    notOrderCreation: true,
  },
  {
    id: 'woo-on-hold', family: 'woocommerce-like', senderEmail: 'orders@oak-demo.shop',
    subject: 'Order #WC-88002 is on hold',
    bodyText: 'We received order #WC-88002 and are waiting for bank transfer confirmation before processing.',
    notOrderCreation: true,
  },
  {
    id: 'woo-processing', family: 'woocommerce-like', senderEmail: 'orders@oak-demo.shop',
    subject: 'Your order #WC-88003 is being processed',
    bodyText: 'Payment has been received for order #WC-88003. We are now preparing the order for fulfillment.',
    notOrderCreation: true,
    notDelivered: true,
  },
  {
    id: 'woo-completed', family: 'woocommerce-like', senderEmail: 'orders@oak-demo.shop',
    subject: 'Order #WC-88003 complete',
    bodyText: 'Order #WC-88003 has been completed. No tracking number is included in this message.',
    notOrderCreation: true,
  },
  {
    id: 'woo-full-refund', family: 'woocommerce-like', senderEmail: 'orders@oak-demo.shop',
    subject: 'Order #WC-88004 refunded',
    bodyText: 'A full refund was issued for order #WC-88004 in the amount of 64.90 EUR.',
    notOrderCreation: true,
  },
  {
    id: 'woo-partial-refund', family: 'woocommerce-like', senderEmail: 'orders@oak-demo.shop',
    subject: 'Partial refund for order #WC-88005',
    bodyText: 'A partial refund of 10.00 EUR was issued for order #WC-88005. The order is not fully refunded.',
    notOrderCreation: true,
  },
  {
    id: 'woo-invoice-payment-link', family: 'woocommerce-like', senderEmail: 'billing@oak-demo.shop',
    subject: 'Order details and payment link for #WC-88006',
    bodyText: 'Order #WC-88006 is awaiting payment. Use the payment link to complete this existing order. Amount due: 39.90 EUR.',
    notOrderCreation: true,
  },
  {
    id: 'carrier-dpd-out-for-delivery', family: 'carrier', senderEmail: 'notice@dpd.com',
    subject: 'Out for delivery',
    bodyText: 'Your parcel is out for delivery today. Tracking number: 16380124268888.',
    mustRecognize: true,
    notOrderCreation: true,
    notDelivered: true,
  },
  {
    id: 'carrier-dhl-delivered', family: 'carrier', senderEmail: 'notify@dhl.com',
    subject: 'Shipment delivered successfully',
    bodyText: 'Your shipment was delivered successfully. Tracking number: 00340434161094000123.',
    mustRecognize: true,
    notOrderCreation: true,
  },
  {
    id: 'carrier-ups-in-transit', family: 'carrier', senderEmail: 'updates@ups.com',
    subject: 'Your package is in transit',
    bodyText: 'Your package is moving through our network. Tracking number: 1Z999AA10123456784.',
    mustRecognize: true,
    notOrderCreation: true,
    notDelivered: true,
  },
  {
    id: 'carrier-lookalike-dhl', family: 'noise', senderEmail: 'alerts@notify.dhl.com.attacker.example',
    subject: 'Shipment delivered successfully',
    bodyText: 'Tracking number: 00340434161094000999. Your shipment was delivered successfully.',
    mustHold: true,
    notOrderCreation: true,
  },
  {
    id: 'shopify-account-reset', family: 'noise', senderEmail: 'accounts@wildberry-demo.com',
    subject: 'Reset your account password',
    bodyText: 'Use this link to reset your customer account password. This is not an order or shipment message.',
    mustHold: true,
    notOrderCreation: true,
  },
];

function observe(fixture: Fixture): Observation {
  const domain = senderDomain(fixture.senderEmail);
  const lifecycle = parseDeterministicLifecycleEmail({
    senderDomains: [domain],
    senderEmails: [fixture.senderEmail],
    subject: fixture.subject,
    bodyText: fixture.bodyText,
  });
  if (lifecycle) {
    return {
      id: fixture.id,
      family: fixture.family,
      recognized: true,
      route: 'lifecycle',
      eventType: lifecycle.extraction.event_type,
      lifecycleEvent: lifecycle.lifecycleEvent,
      shipmentPhase: lifecycle.shipmentPhase ?? null,
      orderNumber: lifecycle.extraction.order_number,
      trackingNumber: lifecycle.extraction.tracking_number,
    };
  }

  const commerce = parseDeterministicCommerceEmail({
    senderDomains: [domain],
    subject: fixture.subject,
    bodyText: fixture.bodyText,
  });
  if (commerce) {
    return {
      id: fixture.id,
      family: fixture.family,
      recognized: true,
      route: 'commerce',
      eventType: commerce.extraction.event_type,
      lifecycleEvent: null,
      shipmentPhase: commerce.shipmentPhase ?? null,
      orderNumber: commerce.extraction.order_number,
      trackingNumber: commerce.extraction.tracking_number,
    };
  }

  return {
    id: fixture.id,
    family: fixture.family,
    recognized: false,
    route: null,
    eventType: null,
    lifecycleEvent: null,
    shipmentPhase: null,
    orderNumber: null,
    trackingNumber: null,
  };
}

test('web-derived unseen notification benchmark remains safe and reports coverage gaps', () => {
  const observations = fixtures.map(observe);
  const byId = new Map(observations.map((row) => [row.id, row]));

  for (const fixture of fixtures) {
    const row = byId.get(fixture.id)!;
    if (fixture.mustRecognize) {
      assert.equal(row.recognized, true, `${fixture.id} should be recognized`);
    }
    if (fixture.mustHold) {
      assert.equal(row.recognized, false, `${fixture.id} should be held/ignored safely`);
    }
    if (fixture.notOrderCreation) {
      assert.notEqual(row.eventType, 'order_created', `${fixture.id} must not create a new Purchase`);
    }
    if (fixture.notDelivered) {
      assert.notEqual(row.eventType, 'delivery', `${fixture.id} must not be treated as delivered`);
    }
  }

  const dpd = byId.get('carrier-dpd-out-for-delivery')!;
  assert.equal(dpd.eventType, 'shipment');

  const dhl = byId.get('carrier-dhl-delivered')!;
  assert.equal(dhl.eventType, 'delivery');

  const report = {
    fixtures: fixtures.length,
    recognized: observations.filter((row) => row.recognized).length,
    heldOrUnrecognized: observations.filter((row) => !row.recognized).length,
    observations,
    importantCoverageGaps: observations
      .filter((row) => !row.recognized && !['carrier-lookalike-dhl', 'shopify-account-reset', 'shopify-pos-receipt-short-id'].includes(row.id))
      .map((row) => row.id),
    conservativeSemantics: {
      dpdOutForDeliveryEvent: dpd.eventType,
      dpdOutForDeliveryPhase: dpd.shipmentPhase,
      dhlDeliveredEvent: dhl.eventType,
    },
  };

  console.log(`WEB_UNSEEN_EMAIL_BENCHMARK ${JSON.stringify(report)}`);
});
