import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGenericOrderConfirmationEmail } from './generic-order-confirmation-adapter.js';

// Synthetic fixtures. They intentionally imitate common structural fields documented by
// Shopify, WooCommerce, Adobe Commerce/Magento and Shoprenter without copying any real
// customer's message or a vendor's full copyrighted template.

const positives = [
  {
    name: 'Shopify-like English confirmation',
    senderDomains: ['orders.northstar-demo.com'],
    subject: 'Order #SHP-10482 confirmed',
    bodyText: [
      'Thanks for your order',
      'Order #SHP-10482',
      'Order summary',
      'Trail Backpack | Qty 1 | 79.90 EUR',
      'Order total: 84.90 EUR',
      'Payment method: Visa ending 4242',
      'Shipping method: Standard Shipping',
    ].join('\n'),
    orderNumber: 'SHP-10482',
    total: 84.9,
    currency: 'EUR',
    paymentStatus: 'unknown',
  },
  {
    name: 'WooCommerce-like Hungarian confirmation',
    senderDomains: ['mail.kekbolt.hu'],
    subject: 'Rendelés visszaigazolás – WC-58321',
    bodyText: [
      'Köszönjük a megrendelésed!',
      'Rendelésszám: WC-58321',
      'Rendelés részletei',
      'Kék kulacs | Mennyiség 2 | 12 980 Ft',
      'Végösszeg: 14 970 Ft',
      'Fizetési mód: Utánvét',
      'Szállítási mód: GLS házhoz szállítás',
    ].join('\n'),
    orderNumber: 'WC-58321',
    total: 14970,
    currency: 'HUF',
    paymentStatus: 'cash_on_delivery',
  },
  {
    name: 'Magento-like German confirmation',
    senderDomains: ['store.bergwerk.de'],
    subject: 'Bestellbestätigung #DE-900731',
    bodyText: [
      'Vielen Dank für Ihre Bestellung',
      'Bestellnummer: DE-900731',
      'Bestellübersicht',
      'Wanderschuhe | Menge 1 | 129,90 EUR',
      'Gesamtbetrag: 134,90 EUR',
      'Zahlungsart: PayPal',
      'Versandart: DHL Paket',
    ].join('\n'),
    orderNumber: 'DE-900731',
    total: 134.9,
    currency: 'EUR',
    paymentStatus: 'unknown',
  },
  {
    name: 'French unknown-shop confirmation',
    senderDomains: ['commande.maison-lune.fr'],
    subject: 'Confirmation de commande FR-771204',
    bodyText: [
      'Merci pour votre commande',
      'Numéro de commande: FR-771204',
      'Détails de la commande',
      'Lampe de table | Qté 1 | 49,90 EUR',
      'Total TTC: 54,90 EUR',
      'Mode de paiement: Carte bancaire',
      'Mode de livraison: Colissimo',
    ].join('\n'),
    orderNumber: 'FR-771204',
    total: 54.9,
    currency: 'EUR',
    paymentStatus: 'unknown',
  },
  {
    name: 'Spanish unknown-shop confirmation',
    senderDomains: ['pedidos.casa-sol.es'],
    subject: 'Confirmación de pedido ES-44321',
    bodyText: [
      'Gracias por tu pedido',
      'Número de pedido: ES-44321',
      'Resumen del pedido',
      'Juego de vasos | Qty 1 | 39,95 EUR',
      'Total del pedido: 44,95 EUR',
      'Método de pago: Tarjeta',
      'Método de envío: Correos',
    ].join('\n'),
    orderNumber: 'ES-44321',
    total: 44.95,
    currency: 'EUR',
    paymentStatus: 'unknown',
  },
  {
    name: 'generic English confirmation without platform branding',
    senderDomains: ['receipt.tiny-gadget.shop'],
    subject: 'Your order is confirmed',
    bodyText: [
      'We have received your order.',
      'Order number: TG/2026/8812',
      'Order details',
      'USB-C hub x 1 29.99 EUR',
      'Grand total: 34.99 EUR',
      'Payment method: Mastercard',
    ].join('\n'),
    orderNumber: 'TG/2026/8812',
    total: 34.99,
    currency: 'EUR',
    paymentStatus: 'unknown',
  },
  {
    name: 'generic paid order confirmation',
    senderDomains: ['orders.pixel-market.eu'],
    subject: 'Order confirmation PM-20260815-77',
    bodyText: [
      "We've received your order",
      'Order ID: PM-20260815-77',
      'Order summary',
      'Camera strap | Qty 1 | 24.00 EUR',
      'Order total: 24.00 EUR',
      'Payment method: Apple Pay',
      'Payment successful',
    ].join('\n'),
    orderNumber: 'PM-20260815-77',
    total: 24,
    currency: 'EUR',
    paymentStatus: 'paid',
  },
  {
    name: 'Shoprenter-like Hungarian bank transfer confirmation',
    senderDomains: ['shop.demo-aruhaz.hu'],
    subject: 'Megrendelés visszaigazolás SR-781155',
    bodyText: [
      'Köszönjük megrendelését!',
      'Megrendelés azonosító: SR-781155',
      'Megrendelés adatai',
      'Kávédaráló | Mennyiség 1 | 18 990 Ft',
      'Fizetendő: 20 480 Ft',
      'Fizetési mód: Banki átutalás',
      'Szállítási mód: Csomagautomata',
    ].join('\n'),
    orderNumber: 'SR-781155',
    total: 20480,
    currency: 'HUF',
    paymentStatus: 'unknown',
  },
];

for (const fixture of positives) {
  test(`generic parser recognizes ${fixture.name}`, () => {
    const parsed = parseGenericOrderConfirmationEmail({
      senderDomains: fixture.senderDomains,
      subject: fixture.subject,
      bodyText: fixture.bodyText,
    });
    assert.ok(parsed, fixture.name);
    assert.equal(parsed.extraction.event_type, 'order_created');
    assert.equal(parsed.extraction.order_number, fixture.orderNumber);
    assert.equal(parsed.extraction.total, fixture.total);
    assert.equal(parsed.extraction.currency, fixture.currency);
    assert.equal(parsed.extraction.payment_status, fixture.paymentStatus);
    assert.ok(parsed.extraction.confidence >= 0.9);
  });
}

test('extracts obvious structured product rows without requiring a merchant adapter', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.northstar-demo.com'],
    subject: 'Order #SHP-10482 confirmed',
    bodyText: [
      'Thanks for your order',
      'Order #SHP-10482',
      'Order summary',
      'Trail Backpack | Qty 1 | 79.90 EUR',
      'Water Bottle | Qty 2 | 20.00 EUR',
      'Order total: 104.90 EUR',
      'Payment method: Visa',
    ].join('\n'),
  });
  assert.ok(parsed);
  assert.equal(parsed.extraction.products.length, 2);
  assert.equal(parsed.extraction.products[0]?.name, 'Trail Backpack');
  assert.equal(parsed.extraction.products[1]?.quantity, 2);
});

const negatives = [
  {
    name: 'marketing newsletter mentioning orders',
    senderDomains: ['news.fashion-demo.com'],
    subject: 'Order today and save 20%',
    bodyText: 'Thank you for your order of attention! Our summer sale is live. No purchase was made.',
  },
  {
    name: 'abandoned cart reminder',
    senderDomains: ['cart.example-shop.com'],
    subject: 'You left something in your cart',
    bodyText: 'Complete your order today. Cart total: 59.90 EUR. Payment method available: Visa.',
  },
  {
    name: 'carrier delivery message with merchant order reference',
    senderDomains: ['dhl.com'],
    subject: 'Your parcel is on the way',
    bodyText: 'Order number: SHP-10482\nOrder total: 84.90 EUR\nThank you for your order. Tracking: 1234567890123',
  },
  {
    name: 'invoice-only message',
    senderDomains: ['billing.example-store.eu'],
    subject: 'Invoice INV-2026-8821',
    bodyText: 'Order number: ORD-7712\nGrand total: 89.00 EUR\nYour invoice is attached.',
  },
  {
    name: 'shipment update',
    senderDomains: ['orders.example-store.eu'],
    subject: 'Order ORD-7712 shipped',
    bodyText: 'Order number: ORD-7712\nGrand total: 89.00 EUR\nShipping method: GLS\nYour parcel has left our warehouse.',
  },
  {
    name: 'payment receipt without order creation evidence',
    senderDomains: ['payments.example-store.eu'],
    subject: 'Payment received',
    bodyText: 'Order ID: ORD-7712\nOrder total: 89.00 EUR\nPayment method: Visa\nPayment successful.',
  },
];

for (const fixture of negatives) {
  test(`generic parser rejects ${fixture.name}`, () => {
    assert.equal(parseGenericOrderConfirmationEmail({
      senderDomains: fixture.senderDomains,
      subject: fixture.subject,
      bodyText: fixture.bodyText,
    }), null);
  });
}
