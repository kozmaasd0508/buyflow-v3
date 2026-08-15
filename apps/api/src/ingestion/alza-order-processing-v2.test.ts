import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAlzaLifecycleEmail } from './alza-lifecycle-adapter.js';

const body = [
  'Megrendelés 987654321',
  '987654321 sz. megrendelésed feldolgozását megkezdtük.',
  'Számla letöltése [URL: https://www.alza.hu/Apps/pdfdoc.asp?d=AHUW261234567&x=SAFE]',
  'Ez egy automatikusan generált üzenet, mellyel még nem jött létre szerződés közöttünk.',
  'A szerződés létrejöttéről további e-mailben fogunk tájékoztatni.',
  'Hivatkozási szám: 987654321',
  'Összeg: 3350 HUF',
  '1x Szállítás - AlzaBox',
  '1 190,00 HUF',
  '1x Kedvezményes szállítás - AlzaPlus+',
  '-1 190,00 HUF',
  'Fizetendő összesen (ÁFÁ-val együtt):',
  '3 350 HUF',
  'Fizetendő kártyával átvételkor (vagy online is kifizetheted).',
  'Alza.hu Kft., székhely: Budapest',
].join('\n');

function assertFallsBackWithoutFinancialTrust(bodyText: string) {
  const parsed = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: 'Már dolgozunk rajta. / 987654321 sz. megr.',
    bodyText,
  });
  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'deterministic-lifecycle-v1');
  assert.equal(parsed.lifecycleEvent, 'order_processing');
  assert.equal(parsed.extraction.event_type, 'order_updated');
  assert.equal(parsed.extraction.order_number, '987654321');
  assert.equal(parsed.extraction.total, null);
  assert.equal(parsed.extraction.invoice_number, null);
  assert.equal(parsed.extraction.shipping_method, null);
  assert.equal(parsed.extraction.payment_method, null);
}

test('extracts strict Alza processing evidence without promoting it to order_created', () => {
  const parsed = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: 'Már dolgozunk rajta. / 987654321 sz. megr.',
    bodyText: body,
  });
  assert.ok(parsed);
  assert.equal(parsed.parserVersion, 'alza-order-processing-v2');
  assert.equal(parsed.lifecycleEvent, 'order_processing');
  assert.equal(parsed.extraction.event_type, 'order_updated');
  assert.equal(parsed.extraction.order_number, '987654321');
  assert.equal(parsed.extraction.merchant_legal_name, 'Alza.hu Kft.');
  assert.equal(parsed.extraction.total, 3350);
  assert.equal(parsed.extraction.currency, 'HUF');
  assert.equal(parsed.extraction.payment_status, 'pending');
  assert.equal(parsed.extraction.payment_method, 'Kártya átvételkor vagy online');
  assert.equal(parsed.extraction.shipping_method, 'AlzaBox');
  assert.equal(parsed.extraction.invoice_number, 'AHUW261234567');
  assert.equal(parsed.extraction.confidence, 0.995);
  assert.ok(parsed.reasons.includes('explicit_no_contract_yet'));
});

test('mismatched reference order cannot enter the V2 financial reconstruction lane', () => {
  assertFallsBackWithoutFinancialTrust(body.replace('Hivatkozási szám: 987654321', 'Hivatkozási szám: 987654322'));
});

test('disagreeing duplicate totals cannot enter the V2 financial reconstruction lane', () => {
  assertFallsBackWithoutFinancialTrust(body.replace('3 350 HUF', '3 349 HUF'));
});

test('missing explicit no-contract statement cannot enter the V2 financial reconstruction lane', () => {
  assertFallsBackWithoutFinancialTrust(body.replace('Ez egy automatikusan generált üzenet, mellyel még nem jött létre szerződés közöttünk.', ''));
});

test('rejects lookalike Alza sender domain', () => {
  assert.equal(parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu.attacker.example'],
    subject: 'Már dolgozunk rajta. / 987654321 sz. megr.',
    bodyText: body,
  }), null);
});
