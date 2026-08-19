import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { parseProviderLifecycleV6, PROVIDER_LIFECYCLE_V6_VERSION } from './provider-lifecycle-v6-adapter.js';

function email(subject: string, from: string): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: `${from}:${subject}`,
    subject,
    from: [{ email: from }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-19T20:00:00.000Z',
    snippet: subject,
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

test('marketing and support-style subjects do not match provider v6', () => {
  assert.equal(parseProviderLifecycleV6(email('Ingyenes szállítás MINDENRE 🚚', 'message@message.sinsay.com')), null);
  assert.equal(parseProviderLifecycleV6(email('Re: 605855685055000013605231 - 3010206178 - [FKN-HKKTL-917]', 'info@support.gymbeam.hu')), null);
  assert.equal(parseProviderLifecycleV6(email('Változás Általános Szerződési Feltételeinkben', 'info@hirek.packeta.hu')), null);
});
