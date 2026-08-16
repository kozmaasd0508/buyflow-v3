import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input).filter((row) => row.protocol_id === 'payment.paypal');
}

const STATEMENT_BODY = [
  'Kozma Example - tekintse át, milyen pénzmozgások történtek számláján az utóbbi időben.',
  'Havi PayPal-számlakivonata elkészült.',
  'Szokásos havi számlakivonata elkészült, és máris megtekinthető.',
  'Visszatéríthető visszaküldés',
  'Meggondolta magát? Mi álljuk a termék visszaküldésének költségét.',
  'Tranzakcióit már megtekintheti.',
].join('\n');

const LEGAL_BODY = [
  'Hello, Example User',
  "We're making some changes to our legal agreements that will apply to you",
  'The information is also provided in your PayPal Message Center.',
].join('\n');

test('PayPal monthly statement is OTHER in shadow and invisible to production', () => {
  const input = {
    senderDomains: ['mail.paypal.com'],
    senderAddresses: ['paypal@mail.paypal.com'],
    dkimDomains: ['mail.paypal.com'],
    returnPathDomains: ['mail.paypal.com'],
    subject: 'Tekintse át, milyen pénzmozgások történtek számláján az utóbbi időben.',
    bodyText: STATEMENT_BODY,
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence[0]?.production_eligible, false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('refund and return words in PayPal monthly statement never become REFUNDED or RETURN', () => {
  const evidence = rows({
    senderDomains: ['mail.paypal.com'],
    senderAddresses: ['paypal@mail.paypal.com'],
    dkimDomains: ['mail.paypal.com'],
    subject: 'Tekintse át, milyen pénzmozgások történtek számláján az utóbbi időben.',
    bodyText: STATEMENT_BODY,
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['OTHER']);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
});

test('PayPal legal agreement communication is OTHER only', () => {
  const evidence = rows({
    senderDomains: ['communications.paypal.com'],
    senderAddresses: ['no_reply@communications.paypal.com'],
    dkimDomains: ['communications.paypal.com'],
    subject: "We're making some changes to our PayPal legal agreements",
    bodyText: LEGAL_BODY,
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_CREATE_PURCHASE'));
});

test('lookalike PayPal DKIM is rejected', () => {
  assert.deepEqual(rows({
    senderDomains: ['mail.paypal.com'],
    senderAddresses: ['paypal@mail.paypal.com'],
    dkimDomains: ['mail.paypal.com.attacker.example'],
    subject: 'Tekintse át, milyen pénzmozgások történtek számláján az utóbbi időben.',
    bodyText: STATEMENT_BODY,
  }), []);
});

test('merchant email mentioning PayPal does not inherit PayPal authority', () => {
  assert.deepEqual(rows({
    senderDomains: ['shop.example'],
    senderAddresses: ['orders@shop.example'],
    dkimDomains: ['shop.example'],
    subject: 'PayPal payment completed for your order',
    bodyText: 'Your PayPal payment was successful. Transaction ID: 1AB23456CD789012E',
  }), []);
});

test('unverified PayPal-looking transaction sender is not promoted to payment lifecycle', () => {
  const fixtures = [
    { subject: 'You sent a payment', bodyText: 'Payment completed. Transaction ID: 1AB23456CD789012E' },
    { subject: 'Your payment was declined', bodyText: 'Payment failed. Please try again.' },
    { subject: 'Action required for your payment', bodyText: 'Complete authentication to continue.' },
    { subject: 'Your refund is complete', bodyText: 'Refund completed. Transaction ID: 1AB23456CD789012E' },
    { subject: 'A dispute was opened', bodyText: 'Case ID PP-D-123456789' },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(rows({
      senderDomains: ['paypal.com'],
      senderAddresses: ['service@paypal.com'],
      dkimDomains: ['paypal.com'],
      ...fixture,
    }), []);
  }
});

test('authenticated statement sender with transaction-like subject alone does not become payment success', () => {
  assert.deepEqual(rows({
    senderDomains: ['mail.paypal.com'],
    senderAddresses: ['paypal@mail.paypal.com'],
    dkimDomains: ['mail.paypal.com'],
    subject: 'You sent a payment',
    bodyText: 'Payment completed. Transaction ID: 1AB23456CD789012E',
  }), []);
});

test('PayPal account statement does not expose guessed payment or order identifiers', () => {
  const [evidence] = rows({
    senderDomains: ['mail.paypal.com'],
    senderAddresses: ['paypal@mail.paypal.com'],
    dkimDomains: ['mail.paypal.com'],
    subject: 'Elkészült az első PayPal-számlakivonata',
    bodyText: STATEMENT_BODY.replace('Havi PayPal-számlakivonata elkészült.', 'PayPal-számlakivonata elkészült.'),
  });
  assert.ok(evidence);
  assert.equal(evidence.identifiers.payment_reference, null);
  assert.equal(evidence.identifiers.order_id, null);
  assert.equal(evidence.identifiers.invoice_id, null);
});
