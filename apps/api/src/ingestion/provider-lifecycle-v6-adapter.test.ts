import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import {
  isProviderLifecycleV6Noise,
  parseProviderLifecycleV6,
  PROVIDER_LIFECYCLE_V6_VERSION,
} from './provider-lifecycle-v6-adapter.js';

function email(subject: string, from: string, snippet = subject): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `${from}:${subject}`,
    subject,
    from: [{ email: from }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-19T20:00:00.000Z',
    snippet,
    folders: ['inbox'],
    attachments: [],
  };
}

test('FOXPOST provider lifecycle subjects are recognized only on foxpost.hu', () => {
  const ready = parseProviderLifecycleV6(email('Csomagod megérkezett', 'no-reply@foxpost.hu'));
  assert.equal(ready?.parserVersion, PROVIDER_LIFECYCLE_V6_VERSION);
  assert.equal(ready?.extraction.event_type, 'shipment');
  assert.equal(ready?.shipmentPhase, 'ready_for_pickup');
  assert.equal(ready?.extraction.carrier, 'Foxpost');

  const warehouse = parseProviderLifecycleV6(email('Csomagod már a raktárunkban van', 'no-reply@foxpost.hu'));
  assert.equal(warehouse?.shipmentPhase, 'in_transit');

  const returned = parseProviderLifecycleV6(email('Át nem vett csomagodat visszaszállítottuk', 'no-reply@foxpost.hu'));
  assert.equal(returned?.extraction.event_type, 'return');

  assert.equal(parseProviderLifecycleV6(email('Csomagod megérkezett', 'newsletter@example.com')), null);
});

test('MPL/Posta lifecycle subjects map to shipment phases', () => {
  const pickup = parseProviderLifecycleV6(email('Csomagod a postán átvehető', 'kozponti.ertesites@posta.hu'));
  assert.equal(pickup?.shipmentPhase, 'ready_for_pickup');
  assert.equal(pickup?.extraction.carrier, 'MPL');

  const out = parseProviderLifecycleV6(email('Csomagod a kézbesítőnél van', 'kozponti.ertesites@posta.hu'));
  assert.equal(out?.shipmentPhase, 'out_for_delivery');

  const shipped = parseProviderLifecycleV6(email('Csomagot adtak fel neked', 'kozponti.ertesites@posta.hu'));
  assert.equal(shipped?.shipmentPhase, 'shipped');
});

test('Packeta transport acceptance is provider-scoped shipment evidence', () => {
  const parsed = parseProviderLifecycleV6(email('A szállítmányt elfogadták a szállításra', 'noreply@packeta.hu'));
  assert.equal(parsed?.extraction.event_type, 'shipment');
  assert.equal(parsed?.shipmentPhase, 'shipped');
  assert.equal(parsed?.extraction.carrier, 'Packeta');
});

test('Gate order creation and shipment subjects are provider-scoped', () => {
  const created = parseProviderLifecycleV6(email('Köszönjük, hogy a Gate-nél vásárolt.', 'noreply@gate.shop'));
  assert.equal(created?.extraction.event_type, 'order_created');

  const shipped = parseProviderLifecycleV6(email('Megrendelésének elküldése', 'noreply@gate.shop'));
  assert.equal(shipped?.extraction.event_type, 'shipment');
  assert.equal(shipped?.shipmentPhase, 'shipped');
});

test('failed payment wording cannot become payment_completed', () => {
  const parsed = parseProviderLifecycleV6(email(
    'Gyerekjatekbolt.com – a(z) 535574. számú rendeléshez tartozó tranzakció sikertelen volt',
    'gyerekjatekbolt@gyerekjatekbolt.com',
  ));

  assert.equal(parsed?.extraction.event_type, 'order_updated');
  assert.equal(parsed?.extraction.payment_status, 'failed');
});

test('trusted support reply with order anchor and explicit delivery delay is shipment evidence', () => {
  const parsed = parseProviderLifecycleV6(email(
    'Re: 605855685055000013605231 - 3010206178 - [FKN-HKKTL-917]',
    'info@support.gymbeam.hu',
    'Kedves Vásárló, csomagja kézbesítésében logisztikai okok miatt egy napos csúszás várható az Express One szolgáltatásában.',
  ));

  assert.equal(parsed?.parserVersion, PROVIDER_LIFECYCLE_V6_VERSION);
  assert.equal(parsed?.extraction.event_type, 'shipment');
  assert.equal(parsed?.shipmentPhase, 'in_transit');
  assert.equal(parsed?.extraction.carrier, 'Express One');
});

test('support reply exception requires domain, order anchor and explicit lifecycle evidence together', () => {
  const subject = 'Re: 605855685055000013605231 - 3010206178 - [FKN-HKKTL-917]';
  const delay = 'Csomagja kézbesítésében logisztikai okok miatt egy napos csúszás várható az Express One szolgáltatásában.';

  assert.equal(parseProviderLifecycleV6(email(subject, 'support@example.com', delay)), null);
  assert.equal(parseProviderLifecycleV6(email('Re: Általános kérdés', 'info@support.gymbeam.hu', delay)), null);
  assert.equal(parseProviderLifecycleV6(email(subject, 'info@support.gymbeam.hu', 'Köszönjük megkeresését, hamarosan válaszolunk.')), null);
});

test('marketing and unrelated support-style subjects do not match provider v6', () => {
  assert.equal(parseProviderLifecycleV6(email('Ingyenes szállítás MINDENRE 🚚', 'message@message.sinsay.com')), null);
  assert.equal(parseProviderLifecycleV6(email('Re: 605855685055000013605231 - 3010206178 - [FKN-HKKTL-917]', 'info@support.gymbeam.hu')), null);
  assert.equal(parseProviderLifecycleV6(email('Változás Általános Szerződési Feltételeinkben', 'info@hirek.packeta.hu')), null);
});


test('v5 blind commerce misses require trusted provider and explicit lifecycle evidence', () => {
  const cases: Array<[string, string, string, string]> = [
    ['Csomag átvételének fontossága – automatikus értesítés', 'info@limone.hu', 'A megrendelt csomag hamarosan átadásra kerül a futárszolgálatnak.', 'shipment'],
    ['[famafutar.hu] Értesítés csomag érkezéséről', 'noreply@famafutar.hu', 'Partnerünk küldeményét futárunk a mai napon kézbesítésre átvette.', 'shipment'],
    ['Re: KomPhone.hu webshop - Megrendelés érkezett - 36236-103374', 'info@komphone.hu', 'Rendelését a mai napon átadjuk a futárnak.', 'shipment'],
    ['#1000891562 számú rendeléshez tartozó számla🧾', 'noreply@fizz.hu', 'Legutóbbi megrendelésedhez tartozó számlát csatoltuk.', 'invoice_or_receipt'],
    ['Értesítés a csomag feladásáról', 'noreply@gyujtoszallitas.hu', 'Feladó: KomPhone. Csomagazonosító: 243961932650381013605231', 'shipment'],
    ['KomPhone.hu webshop - Fizetés sikeresen lezárult', 'info@komphone.hu', 'A fizetés sikeresen lezárult!', 'payment_completed'],
    ['Megrendelés folyamatban', 'ertesitesek@allegro.com', 'Átvesszük a megrendelésedet az eladótól. Vásárlásod részletei.', 'order_created'],
    ['Visszaigazolt rendelés - Rendelési azonosító: PE7968048', 'pepita@pepita.hu', 'Logisztikai központunk visszaigazolta a rendelésedet.', 'order_updated'],
    ['Sikertelen kézbesítés', 'kozponti.ertesites@posta.hu', 'Sikertelen kézbesítési értesítő. Kézbesítőnk nem járt sikerrel csomagjának kézbesítésével.', 'shipment'],
    ['Megrendelés visszaigazolása: 2026/8420/001', 'e.varkonyi@utteurope.com', 'Webáruházunkban leadott megrendelését ezennel visszaigazoljuk.', 'order_created'],
  ];

  for (const [subject, sender, snippet, eventType] of cases) {
    const parsed = parseProviderLifecycleV6(email(subject, sender, snippet));
    assert.equal(parsed?.parserVersion, PROVIDER_LIFECYCLE_V6_VERSION, subject);
    assert.equal(parsed?.extraction.event_type, eventType, subject);
  }
});

test('v5 blind provider rules fail closed on wrong domains or missing body evidence', () => {
  assert.equal(parseProviderLifecycleV6(email(
    'Csomag átvételének fontossága – automatikus értesítés',
    'newsletter@example.com',
    'A megrendelt csomag hamarosan átadásra kerül a futárszolgálatnak.',
  )), null);
  assert.equal(parseProviderLifecycleV6(email(
    'Re: KomPhone.hu webshop - Megrendelés érkezett - 36236-103374',
    'info@komphone.hu',
    'Köszönjük megkeresését.',
  )), null);
  assert.equal(parseProviderLifecycleV6(email(
    'Megrendelés folyamatban',
    'ertesitesek@allegro.com',
    'Nézd meg az aktuális ajánlatainkat.',
  )), null);
});

test('v5 blind false positives are provider-scoped non-commerce noise', () => {
  assert.equal(isProviderLifecycleV6Noise(email(
    'SimplePay - Sikeres fizetés - https://www.intrum.hu/ados-ugyfeleknek',
    'noreply@simplepay.hu',
    'Az intrum.hu/ados-ugyfeleknek elfogadóhelyen a tranzakciót sikeresen rendezte.',
  )), true);
  assert.equal(isProviderLifecycleV6Noise(email(
    'Sikeres fizetés visszaigazolás',
    'kozponti.ertesites@posta.hu',
    'Az OTP Mobilalkalmazásból kezdeményezett bankkártyás csekkfizetési tranzakciója sikeres volt.',
  )), true);
  assert.equal(isProviderLifecycleV6Noise(email(
    'Rendelés azonosító: 1000891562',
    'autoreply@fizz.hu',
    'Köszönjük, hogy felvetted velünk a kapcsolatot. Megkeresésedet sikeresen rögzítettük.',
  )), true);

  assert.equal(isProviderLifecycleV6Noise(email(
    'SimplePay - Sikeres fizetés',
    'noreply@simplepay.hu',
    'Webshop rendelés fizetése sikeres.',
  )), false);
  assert.equal(isProviderLifecycleV6Noise(email(
    'Rendelés azonosító: 1000891562',
    'orders@example.com',
    'Megkeresésedet sikeresen rögzítettük.',
  )), false);
});
