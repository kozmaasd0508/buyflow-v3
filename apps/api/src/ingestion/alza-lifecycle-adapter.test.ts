import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAlzaLifecycleEmail } from './alza-lifecycle-adapter.js';

test('parses explicit Alza financing payment failure', () => {
  const result = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: 'Információ a(z) 573521857 sz. megrendelésről',
    bodyText: 'Információ a megrendelésről Megrendelés 573521857 Probléma lépett fel. Nagyon sajnáljuk, a bank elutasította a részletfizetést.',
  });

  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'payment_failed');
  assert.equal(result.extraction.order_number, '573521857');
  assert.equal(result.extraction.payment_status, 'failed');
  assert.equal(result.extraction.merchant, 'Alza.hu');
});

test('parses explicit Alza cancellation', () => {
  const result = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: 'A(z) 573521857 sz. megrendelés törlése',
    bodyText: 'Információ a megrendelésről Megrendelés 573521857 Törölt megrendelés. A megrendelésed töröltük.',
  });

  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'cancelled');
  assert.equal(result.extraction.order_number, '573521857');
});

test('parses explicit Alza delay', () => {
  const result = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: '602385238 sz. megrendelésed késve érkezik',
    bodyText: 'A 602385238 számú megrendelésedet átadtuk a szállítónak. Elnézést kérünk a késésért. A kézbesítés várható új időpontja: 2026.06.26 12:00.',
  });

  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'delayed');
  assert.equal(result.extraction.order_number, '602385238');
});

test('parses Alza processing message as lifecycle instead of a new order', () => {
  const result = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: 'Már dolgozunk rajta. / 602385238 sz. megr.',
    bodyText: 'Információ a megrendelésről\nMegrendelés 602385238\n602385238 sz. megrendelésed feldolgozását megkezdtük.',
  });

  assert.ok(result);
  assert.equal(result.lifecycleEvent, 'order_processing');
  assert.equal(result.extraction.event_type, 'order_updated');
  assert.equal(result.extraction.order_number, '602385238');
});

test('does not classify a normal Alza order confirmation', () => {
  const result = parseAlzaLifecycleEmail({
    senderDomains: ['alza.hu'],
    subject: 'Köszönjük 595825244 sz. megrendelésed',
    bodyText: 'Információ a megrendelésről Megrendelés 595825244 Köszönjük a megrendelést! Megrendelésed rendben megkaptuk.',
  });

  assert.equal(result, null);
});

test('requires an Alza sender domain', () => {
  const result = parseAlzaLifecycleEmail({
    senderDomains: ['example.com'],
    subject: '602385238 sz. megrendelésed késve érkezik',
    bodyText: 'Megrendelés 602385238 Elnézést kérünk a késésért.',
  });

  assert.equal(result, null);
});
