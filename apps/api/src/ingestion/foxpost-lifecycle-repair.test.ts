import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFoxpostLifecycleEmail } from './foxpost-lifecycle-repair.js';

const readyBody = `Kedves Kozma Gábor!
Ezúton értesítünk, hogy GATE.SHOP HU által feladott csomagod megérkezett, amely átvehető az alábbiak szerint:
Csomagautomata megnevezése: FOXPOST A-BOX Fegyvernek Coop
Csomagod Packeta azonosítószáma: Z3493891717
Csomagod FOXPOST azonosítószáma: CLFOX178524111362058
Csomagátvétel határideje: 2026-08-04 12:12
Utánvételi összeg: 12535 Ft`;

test('parses Foxpost ready-for-pickup without calling it delivered', () => {
  const result = parseFoxpostLifecycleEmail({ senderDomains: ['foxpost.hu'], subject: 'Csomagod megérkezett', bodyText: readyBody });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'ready_for_pickup');
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.tracking_number, 'CLFOX178524111362058');
  assert.equal(result.extraction.parcel_sender, 'GATE.SHOP HU');
  assert.equal(result.extraction.cod_amount, 12535);
  assert.equal(result.extraction.cod_currency, 'HUF');
  assert.equal(result.parserVersion, 'foxpost-lifecycle-v1.1');
});

test('prefers labelled Foxpost tracking over Packeta identifier', () => {
  const result = parseFoxpostLifecycleEmail({ senderDomains: ['no-reply.foxpost.hu'], subject: 'Csomagod megérkezett', bodyText: readyBody });
  assert.equal(result?.extraction.tracking_number, 'CLFOX178524111362058');
});

test('parses pre-advice as shipment_created', () => {
  const result = parseFoxpostLifecycleEmail({
    senderDomains: ['foxpost.hu'],
    subject: 'Előértesítés',
    bodyText: `Ezúton értesítünk, hogy GATE.SHOP HU által feladott csomagodhoz csomagszámot hoztak létre. A csomagot még nem adták át a FOXPOST részére. Csomagod FOXPOST azonosítószáma: CLFOX178524111362058`,
  });
  assert.equal(result?.shipmentPhase, 'shipment_created');
});

test('parses warehouse arrival with the live generic Csomagod azonosítószáma label', () => {
  const result = parseFoxpostLifecycleEmail({
    senderDomains: ['foxpost.hu'],
    subject: 'Csomagod már a raktárunkban van',
    bodyText: `Kedves Kozma Gábor!
Csomagod, amelyet BioTechUSA Kft. adott fel számodra, beérkezett raktárunkba, hamarosan megkapod a FOXPOST automatába.
Csomagod azonosítószáma: CLFOX178401889449819
Utánvételi összeg: 16780 Ft`,
  });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'in_transit');
  assert.equal(result.extraction.tracking_number, 'CLFOX178401889449819');
  assert.equal(result.extraction.parcel_sender, 'BioTechUSA Kft.');
  assert.equal(result.extraction.cod_amount, 16780);
  assert.equal(result.extraction.cod_currency, 'HUF');
});

test('rejects generic tracking labels from lookalike sender domains', () => {
  const body = `Csomagod, amelyet BioTechUSA Kft. adott fel számodra, beérkezett raktárunkba. Csomagod azonosítószáma: CLFOX178401889449819`;
  assert.equal(parseFoxpostLifecycleEmail({ senderDomains: ['foxpost.hu.attacker.example'], subject: 'Csomagod már a raktárunkban van', bodyText: body }), null);
});
