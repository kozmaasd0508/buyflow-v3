import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from './detect.js';
import { detectShadowProtocolEvidence } from './shadow.js';

function rows(input: Parameters<typeof detectShadowProtocolEvidence>[0]) {
  return detectShadowProtocolEvidence(input)
    .filter((row) => row.protocol_id === 'merchant.hu.alza');
}

const AUTH = {
  senderDomains: ['alza.hu'],
  senderAddresses: ['segito@alza.hu'],
  dkimDomains: ['alza.hu'],
};

test('Alza received order is ORDER_CREATED and production detector cannot see shadow profile', () => {
  const input = {
    ...AUTH,
    subject: 'Köszönjük 595825244 sz. megrendelésed',
    bodyText: [
      'Megrendelés 595825244',
      'Köszönjük a megrendelést!',
      'Megrendelésed rendben megkaptuk. A feldolgozás folyamatáról további e-mailben fogunk tájékoztatni.',
      'Ez egy automatikusan generált üzenet, mellyel még nem jött létre szerződés közöttünk.',
      'Fizetendő összesen (ÁFÁ-val együtt): 2 260 HUF',
    ].join('\n'),
  };

  assert.deepEqual(detectProtocolEvidence(input), []);
  const evidence = rows(input);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'ORDER_CREATED');
  assert.equal(evidence[0]?.identifiers.order_id, '595825244');
  assert.equal(evidence[0]?.production_eligible, false);
});

test('Alza processing is ORDER_PROCESSING and invoice-looking link alone is not INVOICE', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Már dolgozunk rajta. / 595825244 sz. megr.',
    bodyText: [
      'Megrendelés 595825244',
      'Várd meg a következő SMS/e-mail üzenetet',
      '595825244 sz. megrendelésed feldolgozását megkezdtük.',
      'Számla letöltése https://www.alza.hu/Apps/pdfdoc.asp?d=AHUW261265474&x=SAFE',
      'Ez egy automatikusan generált üzenet, mellyel még nem jött létre szerződés közöttünk.',
    ].join('\n'),
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate), ['ORDER_PROCESSING']);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.equal(evidence.some((row) => row.event_candidate === 'SHIPPED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
});

test('Alza bank transfer request is PAYMENT_ACTION_REQUIRED, not failed or successful payment', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Köszönjük a megrendelést, már csak a fizetés van hátra / 594687258 sz. megr.',
    bodyText: [
      'Megrendelés 594687258',
      'Kérjük, fizess 196 210,00 HUF összeget.',
      'Kérjük, utald el az összeget valamelyik bankszámlánkra.',
      'Hivatkozási szám: 594687258',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'PAYMENT_ACTION_REQUIRED');
  assert.equal(evidence[0]?.identifiers.order_id, '594687258');
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_FAILED'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
});

test('Alza unpaid cancellation is CANCELLED and does not invent PAYMENT_FAILED', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Információ a(z) 594687258 sz. megrendelésről',
    bodyText: [
      'Megrendelés 594687258',
      'A megrendelés törölve',
      'Sajnáljuk, a megrendelésed kénytelenek voltunk törölni, mivel nem lett kifizetve.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'CANCELLED');
  assert.equal(evidence[0]?.identifiers.order_id, '594687258');
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_FAILED'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('Alza explicit DPD handoff is SHIPPED with order and tracking identity', () => {
  const evidence = rows({
    ...AUTH,
    subject: '593968900 sz. megrendelésed épp most küldtük el.',
    bodyText: [
      'https://www.alza.hu/my-account/objednavka-593968900.htm',
      'Megrendelésed átadtuk a szállítónak, amely a következő időpontban fogja kézbesíteni azt: 2026.04.28.',
      'Szállító DPD',
      'Csomag követése https://www.dpdgroup.com/hu/mydpd/my-parcels/track?parcelNumber=16408074681095',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'SHIPPED');
  assert.equal(evidence[0]?.identifiers.order_id, '593968900');
  assert.equal(evidence[0]?.identifiers.tracking_id, '16408074681095');
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('Alza accepted DPD handoff with final invoice link yields SHIPPED and INVOICE separately', () => {
  const evidence = rows({
    ...AUTH,
    subject: '593968900 sz. megrendelésed épp most küldtük el.',
    bodyText: [
      'https://www.alza.hu/my-account/objednavka-593968900.htm',
      'Megrendelésed átadtuk a szállítónak.',
      'Szállító DPD',
      'Csomag követése https://www.dpdgroup.com/hu/mydpd/my-parcels/track?parcelNumber=16408074681095',
      'Számla letöltése https://www.alza.hu/Apps/pdfdoc.asp?d=AHUW261122892&x=SAFE',
      'Az Alza ezzel az üzenettel elfogadta a megrendelésed, és így közöttetek szerződés jött létre az Alza Általános Szerződési Feltételei szerint.',
    ].join('\n'),
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate).sort(), ['INVOICE', 'SHIPPED']);
  const invoice = evidence.find((row) => row.event_candidate === 'INVOICE');
  assert.equal(invoice?.identifiers.invoice_id, null);
  assert.equal(invoice?.identifiers.order_id, '593968900');
});

test('Alza delayed delivery is DELAYED, not DELIVERY_FAILED', () => {
  const evidence = rows({
    ...AUTH,
    subject: '602385238 sz. megrendelésed késve érkezik',
    bodyText: [
      'Megrendelés 602385238',
      'Elnézést kérünk a késésért',
      'A kézbesítés várható új időpontja: 2026.06.26 12:00',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'DELAYED');
  assert.equal(evidence[0]?.identifiers.order_id, '602385238');
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERY_FAILED'), false);
});

test('AlzaBox arrival is READY_FOR_PICKUP and can coexist with final invoice without payment success', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Vedd át 602385238 sz. megrendelésed',
    bodyText: [
      'Megrendelés 602385238',
      'Vedd át a megrendelésed az AlzaBoxból',
      '602385238 sz. megrendelésed megérkezett a Törökszentmiklós AlzaBoxba.',
      'Kód az átvételhez',
      'A fizetendő összeg 3350,00 Ft',
      'Kifizetem online',
      'Számla letöltése https://www.alza.hu/Apps/pdfdoc.asp?d=AHUW261747843&x=SAFE',
      'Az Alza ezzel az üzenettel elfogadta a megrendelésed, és így közöttetek szerződés jött létre az Alza Általános Szerződési Feltételei szerint.',
    ].join('\n'),
  });

  assert.deepEqual(evidence.map((row) => row.event_candidate).sort(), ['INVOICE', 'READY_FOR_PICKUP']);
  assert.equal(evidence.some((row) => row.event_candidate === 'PAYMENT_SUCCESS'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'DELIVERED'), false);
});

test('Alza accepted return request is OTHER until the product is actually received', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Az AVRA26957208 sz. reklamációt befogadtuk',
    bodyText: [
      'AVRA26957208',
      'Küldd el nekünk a terméket',
      'A visszaküldés nyilvántartási száma: AVRA26957208.',
      'Tedd be az AlzaBoxba.',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'OTHER');
  assert.equal(evidence.some((row) => row.event_candidate === 'RETURN'), false);
  assert.equal(evidence.some((row) => row.event_candidate === 'REFUNDED'), false);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('Alza physical receipt of withdrawal item is RETURN but cannot auto-link on AVRA alone', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Vonatkozó információk: AVRA26957208',
    bodyText: [
      'A terméket reklamációra átvettük',
      'Termékedet a reklamáció elrendezése céljából átvettük, a reklamáció nyilvántartási száma: AVRA26957208.',
      'Az eset típusa:',
      'Elállás',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'RETURN');
  assert.equal(evidence[0]?.identifiers.order_id, null);
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_AUTO_LINK'));
  assert.ok(evidence[0]?.prohibitions.includes('DO_NOT_MARK_REFUNDED'));
});

test('Alza explicit card refund-issued email is REFUNDED and links only by observed order URL', () => {
  const evidence = rows({
    ...AUTH,
    subject: 'Pénzt küldünk vissza számodra.',
    bodyText: [
      'Visszatérítettünk 5490 Ft-ot',
      'A bankkártyádra visszautaltunk 5490 Ft-ot.',
      'A bankod gyorsaságának függvényében legkésőbb 3 munkanapon belül jóváírásra kerül.',
      'Az ok a vásárlástól való elállás AVRA26957208.',
      'Részletek https://www.alza.hu/my-account/objednavka-594040388.htm',
      'Számla letöltése https://www.alza.hu/Apps/pdfdoc.asp?d=AHUDW26113387&x=SAFE',
    ].join('\n'),
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.event_candidate, 'REFUNDED');
  assert.equal(evidence[0]?.identifiers.order_id, '594040388');
  assert.equal(evidence.some((row) => row.event_candidate === 'INVOICE'), false);
});

test('Alza same authenticated sender can send marketing without lifecycle evidence', () => {
  assert.deepEqual(rows({
    ...AUTH,
    subject: 'Ma nagyon pörög az AlzaPlus+ vásárlás',
    bodyText: 'Használd ki az AlzaPlus+ program előnyeit, és vásárolj ingyenes kiszállítással bármit, amit csak szeretnél.',
  }), []);
});

test('Alza profile rejects wrong DKIM and subject-only lifecycle lookalikes', () => {
  assert.deepEqual(rows({
    ...AUTH,
    dkimDomains: ['alza.hu.attacker.example'],
    subject: 'Vedd át 602385238 sz. megrendelésed',
    bodyText: 'Megrendelés 602385238. Vedd át a megrendelésed az AlzaBoxból. Megrendelésed megérkezett az AlzaBoxba. Kód az átvételhez.',
  }), []);

  assert.deepEqual(rows({
    ...AUTH,
    subject: '593968900 sz. megrendelésed épp most küldtük el.',
    bodyText: 'Megrendelés 593968900',
  }), []);
});

test('Alza unsupported generic delivered, failed payment and warranty wording stays unsupported', () => {
  const unsupported = [
    ['Kézbesítve', 'Megrendelés 600000001 sikeresen kézbesítve.'],
    ['Sikertelen fizetés', 'Megrendelés 600000001 fizetése sikertelen.'],
    ['Garanciális ügy', 'Megrendelés 600000001 garanciális ügyintézése elindult.'],
  ];

  for (const [subject, bodyText] of unsupported) {
    assert.deepEqual(rows({ ...AUTH, subject, bodyText }), []);
  }
});
