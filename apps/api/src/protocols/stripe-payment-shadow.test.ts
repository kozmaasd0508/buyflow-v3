import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input).filter((row) => row.protocol_id === 'payment.stripe');
}

const EN_PAYMENT_RECEIPT = [
  'Receipt from Example SaaS',
  'Receipt #1166-4449',
  'Amount paid',
  '$25.40',
  'Date paid',
  'Aug 11, 2026, 1:55:17 PM',
  'Payment method',
  '- 2913',
  'Summary',
  'Payment for invoice DEMO-00002 from Example SaaS',
  '$25.40',
  'Amount paid',
  '$25.40',
  'View in browser: https://dashboard.stripe.com/receipts/payment/synthetic-token',
  "You're receiving this email because you made a purchase at Example SaaS, which partners with Stripe to provide invoicing and payment processing.",
].join('\n');

const HU_PAYMENT_RECEIPT = [
  'MintaBolt elismervénye',
  'Elismervény száma: 1986-9430',
  'Kifizetett összeg',
  '6 380,00 Ft',
  'A fizetés dátuma',
  '2026. jan. 24. 14:29:41',
  'Fizetési mód',
  '- 0587',
  'Összegzés',
  'SHOP-104699 × 1',
  '6 380,00 Ft',
  'Kifizetett összeg',
  '6 380,00 Ft',
  'Nézze meg a böngészőjében: https://dashboard.stripe.com/receipts/payment/synthetic-token',
  'Ezt az e-mailt azért kapja, mert vásárolt a MintaBolt kereskedőnél, aki számára a Stripe intézi a számlázási és fizetési folyamatot.',
].join('\n');

const EN_PAID_INVOICE_RECEIPT = [
  'Example SaaS',
  'Receipt from Example SaaS',
  '$25.40',
  'Paid August 11, 2026',
  'Download invoice: https://pay.stripe.com/invoice/acct_DEMO/live_DEMO/pdf',
  'Download receipt: https://dashboard.stripe.com/receipts/invoices/synthetic-token/pdf',
  'Receipt number',
  '2868-6431',
  'Invoice number',
  'DEMO-0001',
  'Payment method',
  '- 2913',
  'Receipt #2868-6431',
  'Subtotal',
  '$20.00',
  'Total',
  '$25.40',
  'Amount paid',
  '$25.40',
].join('\n');

test('Stripe direct payment receipt is shadow PAYMENT_SUCCESS and production registry cannot see it', () => {
  const input = {
    senderDomains: ['stripe.com'],
    senderAddresses: ['receipts+acct_DEMO123@stripe.com'],
    dkimDomains: ['stripe.com'],
    returnPathDomains: ['bounce.stripe.com'],
    subject: 'Your Example SaaS receipt [#1166-4449]',
    bodyText: EN_PAYMENT_RECEIPT,
  };
  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '1166-4449');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.equal(evidence[0]?.identifiers.invoice_id, null);
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('localized Hungarian Stripe receipt is PAYMENT_SUCCESS', () => {
  const evidence = rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['receipts+acct_DEMOHU123@stripe.com'],
    dkimDomains: ['stripe.com'],
    subject: 'Az Ön MintaBolt bizonylata: [1986-9430]',
    bodyText: HU_PAYMENT_RECEIPT,
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '1986-9430');
});

test('paid-invoice Stripe receipt is payment success but does not claim invoice authority', () => {
  const evidence = rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['invoice+statements+acct_DEMO123@stripe.com'],
    dkimDomains: ['stripe.com'],
    subject: 'Your receipt from Example SaaS #2868-6431',
    bodyText: EN_PAID_INVOICE_RECEIPT,
    attachmentFilenames: ['Receipt-2868-6431.pdf', 'Invoice-DEMO-0001.pdf'],
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.identifiers.payment_reference, '2868-6431');
  assert.equal(evidence[0]?.identifiers.invoice_id, null);
});

test('merchant order-like text inside a Stripe receipt is not extracted as BuyFlow order id', () => {
  const [evidence] = rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['receipts+acct_DEMOHU123@stripe.com'],
    dkimDomains: ['stripe.com'],
    subject: 'Az Ön MintaBolt bizonylata: [1986-9430]',
    bodyText: HU_PAYMENT_RECEIPT,
  });
  assert.ok(evidence);
  assert.equal(evidence.identifiers.order_id, null);
});

test('receipt subject alone is insufficient', () => {
  assert.deepEqual(rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['receipts+acct_DEMO123@stripe.com'],
    dkimDomains: ['stripe.com'],
    subject: 'Your Example SaaS receipt [#1166-4449]',
    bodyText: 'Thanks for your payment.',
  }), []);
});

test('lookalike DKIM and merchant-origin Stripe mentions are rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['receipts+acct_DEMO123@stripe.com'],
    dkimDomains: ['stripe.com.attacker.example'],
    subject: 'Your Example SaaS receipt [#1166-4449]',
    bodyText: EN_PAYMENT_RECEIPT,
  }), []);

  assert.deepEqual(rows({
    senderDomains: ['shop.example'],
    senderAddresses: ['billing@shop.example'],
    dkimDomains: ['shop.example'],
    subject: 'Stripe payment receipt',
    bodyText: EN_PAYMENT_RECEIPT,
  }), []);
});

test('other stripe.com account and support senders do not inherit receipt authority', () => {
  for (const senderAddress of ['support@stripe.com', 'notifications@stripe.com', 'receipts@stripe.com']) {
    assert.deepEqual(rows({
      senderDomains: ['stripe.com'],
      senderAddresses: [senderAddress],
      dkimDomains: ['stripe.com'],
      subject: 'Your Example SaaS receipt [#1166-4449]',
      bodyText: EN_PAYMENT_RECEIPT,
    }), []);
  }
});

test('custom merchant email domain is outside Stripe V1 even though Stripe supports custom domains', () => {
  assert.deepEqual(rows({
    senderDomains: ['billing.example.com'],
    senderAddresses: ['receipts+acct_DEMO123@billing.example.com'],
    dkimDomains: ['billing.example.com'],
    subject: 'Your Example SaaS receipt [#1166-4449]',
    bodyText: EN_PAYMENT_RECEIPT,
  }), []);
});

test('finalized but unpaid invoice-like message is not PAYMENT_SUCCESS', () => {
  assert.deepEqual(rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['invoice+statements+acct_DEMO123@stripe.com'],
    dkimDomains: ['stripe.com'],
    subject: 'Your invoice from Example SaaS',
    bodyText: [
      'Invoice number DEMO-0002',
      'Amount due $25.40',
      'Due August 20, 2026',
      'Pay invoice: https://pay.stripe.com/invoice/acct_DEMO/live_DEMO',
    ].join('\n'),
  }), []);
});

test('refund-like authenticated receipt is blocked from payment-success automation and never invents REFUNDED', () => {
  const refundLike = `${EN_PAYMENT_RECEIPT}\nAmount refunded\n$25.40\nYour payment has been refunded.`;
  const evidence = rows({
    senderDomains: ['stripe.com'],
    senderAddresses: ['receipts+acct_DEMO123@stripe.com'],
    dkimDomains: ['stripe.com'],
    subject: 'Your refund from Example SaaS',
    bodyText: refundLike,
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_SUCCESS');
  assert.equal(evidence[0]?.blocked_by_negative_evidence, true);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
});

test('failed, action-required and refund phrases do not invent unsupported Stripe events', () => {
  const fixtures = [
    { subject: 'Payment failed', bodyText: 'Your payment failed. Update your card.' },
    { subject: 'Action required', bodyText: 'Authentication is required to complete your payment.' },
    { subject: 'Refund issued', bodyText: 'A refund has been issued.' },
  ];
  for (const fixture of fixtures) {
    assert.deepEqual(rows({
      senderDomains: ['stripe.com'],
      senderAddresses: ['invoice+statements+acct_DEMO123@stripe.com'],
      dkimDomains: ['stripe.com'],
      ...fixture,
    }), []);
  }
});
