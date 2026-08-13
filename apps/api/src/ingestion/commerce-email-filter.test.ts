import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import {
  identifyMerchantSender,
  isMerchantSender,
  merchantDisplayName,
  registeredMerchantSenders,
} from '../email/sender-role.js';
import { filterCommerceEmail } from './commerce-email-filter.js';
import {
  detectCarrierFromDomains,
  extractLabeledTrackingNumber,
  parseDeterministicCommerceEmail,
} from './deterministic-commerce-parser.js';

function email(overrides: Partial<NormalizedEmail>): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'm1',
    receivedAt: '2026-08-12T10:00:00.000Z',
    from: [{ email: 'hello@example.com' }],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
    ...overrides,
  };
}

test('accepts Gmail purchases category without keyword guessing', () => {
  const result = filterCommerceEmail(email({ folders: ['INBOX', 'CATEGORY_PURCHASES'] }));
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('gmail_category_purchases'));
});

test('accepts known carrier sender', () => {
  const result = filterCommerceEmail(email({ from: [{ email: 'notify@expressone.hu' }] }));
  assert.equal(result.relevant, true);
  assert.ok(result.reasons.includes('known_carrier_sender'));
});

test('accepts schema.org commerce markup', () => {
  const result = filterCommerceEmail(email({
    bodyHtml: '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Order"}</script>',
  }));
  assert.equal(result.relevant, true);
  assert.deepEqual(result.commerceMarkupTypes, ['Order']);
});

test('ignores clearly unrelated email', () => {
  const result = filterCommerceEmail(email({ subject: 'Weekly team notes', snippet: 'Meeting recap' }));
  assert.equal(result.relevant, false);
  assert.deepEqual(result.reasons, []);
});

test('merchant registry uses exact trusted sender domains', () => {
  assert.equal(registeredMerchantSenders().length, 6);
  assert.equal(isMerchantSender(['service.gymbeam.hu'], 'gymbeam'), true);
  assert.equal(isMerchantSender(['GYEREKJATEKBOLT.COM.'], 'gyerekjatekbolt'), true);
  assert.equal(isMerchantSender(['alza.hu'], 'alza'), true);
  assert.equal(isMerchantSender(['aboutyou.hu'], 'aboutyou'), true);
  assert.equal(isMerchantSender(['service-mail.zalando.hu'], 'zalando'), true);
  assert.equal(isMerchantSender(['dorko.hu'], 'dorko'), true);
  assert.equal(merchantDisplayName('alza'), 'Alza.hu');
  assert.equal(merchantDisplayName('aboutyou'), 'ABOUT YOU');
  assert.equal(merchantDisplayName('zalando'), 'Zalando');
  assert.equal(merchantDisplayName('dorko'), 'Dorko');
  assert.equal(identifyMerchantSender(['service.gymbeam.hu'])?.key, 'gymbeam');

  assert.equal(isMerchantSender(['evil-alza.hu'], 'alza'), false);
  assert.equal(isMerchantSender(['alza.hu.attacker.com'], 'alza'), false);
  assert.equal(isMerchantSender(['letter.alza.hu'], 'alza'), false);
  assert.equal(isMerchantSender(['gymbeam.hu'], 'gymbeam'), false);
  assert.equal(isMerchantSender(['aboutyou.com'], 'aboutyou'), false);
  assert.equal(isMerchantSender(['aboutyou.hu.attacker.com'], 'aboutyou'), false);
  assert.equal(isMerchantSender(['news2.zalando.com'], 'zalando'), false);
  assert.equal(isMerchantSender(['service-mail.zalando.hu.attacker.com'], 'zalando'), false);
  assert.equal(isMerchantSender(['dorko.hu.attacker.com'], 'dorko'), false);
  assert.equal(identifyMerchantSender(['unknown.example']), null);
  assert.equal(identifyMerchantSender(['alza.hu', 'service.gymbeam.hu']), null);
});

test('detects supported carrier sender domains', () => {
  assert.equal(detectCarrierFromDomains(['email.gls-hungary.com']), 'GLS');
  assert.equal(detectCarrierFromDomains(['notify.expressone.hu']), 'Express One');
  assert.equal(detectCarrierFromDomains(['mail.dpd.com']), 'DPD');
  assert.equal(detectCarrierFromDomains(['notify.dhl.com']), 'DHL');
  assert.equal(detectCarrierFromDomains(['ups.com']), 'UPS');
  assert.equal(detectCarrierFromDomains(['shop.example.com']), null);
});

test('extracts only explicitly labelled tracking identifiers', () => {
  assert.equal(extractLabeledTrackingNumber('Csomagszám: 12345678901'), '12345678901');
  assert.equal(extractLabeledTrackingNumber('Tracking number: 1Z999AA10123456784'), '1Z999AA10123456784');
  assert.equal(extractLabeledTrackingNumber('Rendelésszám: 12345678901'), null);
});

test('parses a clear GLS shipment without AI', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['email.gls-hungary.com'],
    subject: 'Csomagját átvettük szállításra',
    bodyText: 'Csomagszám: 12345678901',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.carrier, 'GLS');
  assert.equal(result.extraction.tracking_number, '12345678901');
  assert.equal(result.extraction.order_number, null);
});

test('recognizes an explicitly completed delivery', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dpd.com'],
    subject: 'Csomagja sikeresen kézbesítve',
    bodyText: 'Küldeményazonosító: 12345678901234',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'delivery');
});

test('does not treat out-for-delivery wording as already delivered', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['notify.dhl.com'],
    subject: 'Out for delivery',
    bodyText: 'Tracking number: 1234567890',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
});

test('falls back when carrier or labelled tracking evidence is missing', () => {
  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['shop.example.com'],
    subject: 'Tracking number: 12345678901',
  }), null);
  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['email.gls-hungary.com'],
    subject: 'A csomag úton van',
    bodyText: 'Rendelésszám: 12345678901',
  }), null);
});

test('parses GymBeam shipment and invoice patterns', () => {
  const shipment = parseDeterministicCommerceEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Gáborné, a megrendelésed úton van!',
    bodyText: 'A 3010354660 számú rendelésedet becsomagoltuk. Hamarosan a Express One szállító cég kezébe kerül. A 605855688145000013605231 számmal követheted a csomagot.',
  });
  assert.ok(shipment);
  assert.equal(shipment.extraction.order_number, '3010354660');
  assert.equal(shipment.extraction.tracking_number, '605855688145000013605231');
  assert.equal(shipment.extraction.carrier, 'Express One');

  const invoice = parseDeterministicCommerceEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Gáborné a számlád elkészült! - 3010354660',
    bodyText: 'Az 4008987362 számú számlád elkészült.',
  });
  assert.ok(invoice);
  assert.equal(invoice.extraction.event_type, 'invoice_or_receipt');
  assert.equal(invoice.extraction.order_number, '3010354660');
  assert.equal(invoice.extraction.invoice_number, '4008987362');
});

test('keeps rich GymBeam processing email on AI fallback', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Gáborné, a rendelésed feldolgozás alatt van.',
    bodyText: 'A 3010354660 számú rendelésed már készül! Rendelési összesítő: 1x termék 11 190Ft. Bruttó összeg: 25 460Ft.',
  });
  assert.equal(result, null);
});

test('parses only successful Gyerekjatekbolt payment', () => {
  const success = parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Sikeres bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!',
    bodyText: 'A(z) 536066. számú rendelést sikeresen befizette.',
  });
  assert.ok(success);
  assert.equal(success.extraction.event_type, 'payment_completed');
  assert.equal(success.extraction.order_number, '536066');
  assert.equal(success.extraction.payment_status, 'paid');

  const failed = parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Sikertelen bankkártyás fizetés a Gyerekjatekbolt.com webáruházban!',
    bodyText: 'A(z) 535574. számú rendelést NEM sikerült befizetnie.',
  });
  assert.equal(failed, null);
});

test('parses real Gyerekjatekbolt courier handoff as shipment', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Gyerekjatekbolt.com - a(z) 536066. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 536066\nRendelés dátuma: 2026. 08. 04. 13:27:23\nA megrendelés frissítésre került, jelenlegi állapot: Szállítás alatt\nRendelését átadtuk a futárszolgálat részére várhatóan a következő munkanapon kézbesítik Önnek.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.merchant, 'Gyerekjatekbolt.com');
  assert.equal(result.extraction.order_number, '536066');
});

test('parses real Gyerekjatekbolt delivered state as delivery', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Gyerekjatekbolt.com – a(z) 536066. számú rendelés állapota megváltozott',
    bodyText: 'Rendelésszám: 536066\nRendelés dátuma: 2026. 08. 04. 13:27:23\nA megrendelés frissítésre került, jelenlegi állapot:\nRendelés kézbesítve',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'delivery');
  assert.equal(result.extraction.order_number, '536066');
});

test('does not promote Gyerekjatekbolt processing or weak shipping wording', () => {
  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Gyerekjatekbolt.com – Rendelés 536066 – 14.960 Ft',
    bodyText: 'RENDELÉS VISSZAIGAZOLÁS Megrendelése megérkezett, feldolgozása elkezdődött. Rendelésszám: #536066',
  }), null);

  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com'],
    subject: 'Rendelés frissítés',
    bodyText: 'Rendelésszám: 536066. Jelenlegi állapot: Szállítás alatt.',
  }), null);

  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['gyerekjatekbolt.com.attacker.com'],
    subject: 'Rendelés frissítés',
    bodyText: 'Rendelésszám: 536066. Jelenlegi állapot: Szállítás alatt. Rendelését átadtuk a futárszolgálat részére.',
  }), null);
});

test('parses a real Dorko dispatched order as shipment', () => {
  const result = parseDeterministicCommerceEmail({
    senderDomains: ['dorko.hu'],
    subject: 'Dorko: rendelés elküldve',
    bodyText: 'Értesítés: megrendelés elküldve\nRendelés azonosító: DK2001799\nA fenti azonosítójú megrendelése feladásra került a megadott címre.\nSzállítás módja: GLS Automata',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.merchant, 'Dorko');
  assert.equal(result.extraction.order_number, 'DK2001799');
  assert.equal(result.extraction.carrier, 'GLS');
});

test('keeps Dorko confirmation and weak dispatch wording on fallback', () => {
  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['dorko.hu'],
    subject: 'Dorko: DK2001799 rendelés/foglalás visszaigazolás',
    bodyText: 'Beérkezett hozzánk a rendelési/foglalási igénye a Dorko webáruházba. Rendelés azonosító: DK2001799',
  }), null);

  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['dorko.hu'],
    subject: 'Dorko: rendelés elküldve',
    bodyText: 'Rendelés azonosító: DK2001799',
  }), null);

  assert.equal(parseDeterministicCommerceEmail({
    senderDomains: ['dorko.hu.attacker.com'],
    subject: 'Dorko: rendelés elküldve',
    bodyText: 'Értesítés: megrendelés elküldve Rendelés azonosító: DK2001799 A fenti azonosítójú megrendelése feladásra került a megadott címre.',
  }), null);
});
