import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseGenericOrderConfirmationEmail,
  stripQuotedHistoryForGenericOrder,
} from './generic-order-confirmation-adapter.js';

function richHungarianOrder(extra: string[] = []): string {
  return [
    'Köszönjük megrendelésed!',
    'Megrendelés azonosító: HU-2026-8811',
    'Megrendelés adatai',
    'Végösszeg: 24 990 Ft',
    'Fizetési mód: Bankkártya',
    'Szállítási mód: GLS',
    ...extra,
  ].join('\n');
}

function richEnglishOrder(extra: string[] = []): string {
  return [
    'Thanks for your order',
    'Order number: ORD-77881',
    'Order details',
    'Grand total: 79.00 EUR',
    'Payment method: Visa',
    'Shipping method: Standard',
    ...extra,
  ].join('\n');
}

test('Tok-shop-style automatic email contract-formation disclaimer blocks generic order creation', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.tok-demo.hu'],
    subject: 'Megrendelés visszaigazolás HU-2026-8811',
    bodyText: richHungarianOrder([
      'Ez az automatikus e-mail nem jelent automatikus szerződéskötést.',
    ]),
  });

  assert.equal(parsed, null);
});

test('Mulan-style acknowledgement saying the contract has not been formed blocks generic order creation', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.mulan-demo.hu'],
    subject: 'Megrendelés visszaigazolás HU-2026-8811',
    bodyText: richHungarianOrder([
      'Ez az automatikus visszaigazolás nem jelenti a szerződés létrejöttét.',
    ]),
  });

  assert.equal(parsed, null);
});

test('ABOUT YOU-style positive confirmation plus explicit purchase-offer non-acceptance stays blocked', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.fashion-demo.hu'],
    subject: 'Megrendelés visszaigazolása: HU-2026-8811',
    bodyText: richHungarianOrder([
      'A megrendelésed ezennel hivatalosan is meg lett erősítve.',
      'Ez egy automatikusan küldött e-mail, és nem jelenti a vételi szerződés megkötésére vonatkozó ajánlat elfogadását, csak megerősíti, hogy megkaptuk a megrendelést.',
    ]),
  });

  assert.equal(parsed, null);
});

test('English receipt-only acknowledgement that does not accept the offer stays blocked', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.unknown-store.example'],
    subject: 'Order confirmation ORD-77881',
    bodyText: richEnglishOrder([
      'This email acknowledges receipt only and does not constitute acceptance of your offer.',
    ]),
  });

  assert.equal(parsed, null);
});

test('Hungarian Gmail reply cannot create an order from quoted historical confirmation', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.reply-demo.hu'],
    subject: 'Re: Megrendelés visszaigazolás HU-2026-8811',
    bodyText: [
      'Köszönjük levelét, kollégánk hamarosan válaszol.',
      '',
      '2026. aug. 1., Szo, 10:00 időpontban Demo Shop <orders@reply-demo.hu> ezt írta:',
      richHungarianOrder(),
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('English reply cannot create an order from On ... wrote quoted history', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.reply-demo.example'],
    subject: 'Re: Order confirmation ORD-77881',
    bodyText: [
      'Thanks for your message. We will get back to you.',
      '',
      'On Sat, Aug 1, 2026 at 10:00 AM Demo Store <orders@reply-demo.example> wrote:',
      richEnglishOrder(),
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('forwarded historical order alone cannot become a new generic order', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.forward-demo.example'],
    subject: 'Fwd: Order confirmation ORD-77881',
    bodyText: [
      '---------- Forwarded message ---------',
      'From: Demo Store <orders@forward-demo.example>',
      'To: Buyer <buyer@example.com>',
      'Subject: Order confirmation ORD-77881',
      richEnglishOrder(),
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('greater-than quoted lines cannot provide generic order evidence', () => {
  const quoted = richEnglishOrder().split('\n').map((line) => `> ${line}`).join('\n');
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.quote-demo.example'],
    subject: 'Re: Order confirmation ORD-77881',
    bodyText: `Thanks for contacting us.\n${quoted}`,
  });

  assert.equal(parsed, null);
});

test('Outlook-style quoted From/To/Subject block is removed from generic order evidence', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.outlook-demo.example'],
    subject: 'Re: Order confirmation ORD-77881',
    bodyText: [
      'We received your support request.',
      '',
      'From: Demo Store <orders@outlook-demo.example>',
      'Sent: Saturday, August 1, 2026 10:00 AM',
      'To: Buyer <buyer@example.com>',
      'Subject: Order confirmation ORD-77881',
      richEnglishOrder(),
    ].join('\n'),
  });

  assert.equal(parsed, null);
});

test('fresh top-level order remains parseable when an older support thread is quoted below it', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['orders.fresh-demo.hu'],
    subject: 'Megrendelés visszaigazolás HU-2026-8811',
    bodyText: [
      richHungarianOrder(),
      '',
      '-----Eredeti üzenet-----',
      'Feladó: Vevő <buyer@example.com>',
      'Címzett: Demo Shop <orders@fresh-demo.hu>',
      'Tárgy: Korábbi kérdés',
      'Szeretnék érdeklődni a készletről.',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'generic-order-confirmation-v1.4');
  assert.equal(parsed.extraction.order_number, 'HU-2026-8811');
});

test('normal recorded/received order without explicit non-acceptance wording remains a generic anchor', () => {
  const parsed = parseGenericOrderConfirmationEmail({
    senderDomains: ['shop.recorded-demo.hu'],
    subject: 'Rendelésedet rögzítettük',
    bodyText: [
      'Köszönjük megrendelésedet.',
      'Rendelés: #SC-2026-7711',
      'Rendelés részletei',
      'Végösszeg: 16 780 Ft',
      'Szállítási mód: FOXPOST',
    ].join('\n'),
  });

  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'generic-order-confirmation-v1.4');
  assert.equal(parsed.extraction.event_type, 'order_created');
  assert.equal(parsed.extraction.order_number, 'SC-2026-7711');
});

test('quote stripping is narrow and keeps only fresh content above a recognized history boundary', () => {
  const fresh = stripQuotedHistoryForGenericOrder([
    'Friss válasz.',
    '> idézett egy sor',
    'Még friss szöveg.',
    '-----Original Message-----',
    'Order number: OLD-1234',
  ].join('\n'));

  assert.equal(fresh, 'Friss válasz.\nMég friss szöveg.');
});
