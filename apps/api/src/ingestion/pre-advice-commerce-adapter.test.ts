import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMerchantPreAdviceEmail } from './pre-advice-commerce-adapter.js';

test('classifies real GymBeam packed-before-handoff email as shipment_created', () => {
  const result = parseMerchantPreAdviceEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'Gáborné, a megrendelésed úton van!',
    bodyText: 'A 3010354660 számú rendelésedet becsomagoltuk. Hamarosan a Express One szállító cég kezébe kerül. A 605855688145000013605231 számmal követheted a csomagot.',
  });
  assert.ok(result);
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.shipmentPhase, 'shipment_created');
  assert.equal(result.extraction.order_number, '3010354660');
  assert.equal(result.extraction.tracking_number, '605855688145000013605231');
  assert.equal(result.extraction.carrier, 'Express One');
});

test('does not call actual GymBeam physical handoff shipment_created without future-handoff language', () => {
  const result = parseMerchantPreAdviceEmail({
    senderDomains: ['service.gymbeam.hu'],
    subject: 'A csomagod úton van',
    bodyText: 'A 3010354660 számú rendelésedet átadtuk az Express One futárszolgálatnak. A 605855688145000013605231 számmal követheted a csomagot.',
  });
  assert.equal(result, null);
});

test('classifies contradictory real Jatektenger status as shipment_created, not shipped', () => {
  const result = parseMerchantPreAdviceEmail({
    senderDomains: ['jatektenger.hu'],
    subject: 'Játéktenger - Megrendelés státusz módosítás',
    bodyText: 'Azonosító 26083-131173 Státusz Csomag átadva a futárszolgálatnak kiszállításhoz. A csomagot kollégáink elkészítették, a következő átadáskor átadják a futárszolgálat részére. Csomagszám 103365121467000013605231 https://tracking.expressone.hu/',
  });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'shipment_created');
  assert.equal(result.extraction.merchant, 'Játéktenger');
  assert.equal(result.extraction.order_number, '26083-131173');
  assert.equal(result.extraction.tracking_number, '103365121467000013605231');
  assert.equal(result.extraction.carrier, 'Express One');
});

test('keeps Jatektenger confirmation on existing rich extraction path', () => {
  const result = parseMerchantPreAdviceEmail({
    senderDomains: ['jatektenger.hu'],
    subject: 'Automata megrendelés visszaigazolás - 26083-131173',
    bodyText: 'Megrendelését rögzítettük, kollégáink hamarosan megkezdik az összekészítést.',
  });
  assert.equal(result, null);
});

test('rejects lookalike Jatektenger sender and missing tracking identity', () => {
  assert.equal(parseMerchantPreAdviceEmail({
    senderDomains: ['jatektenger.hu.attacker.com'],
    subject: 'Játéktenger - Megrendelés státusz módosítás',
    bodyText: 'Azonosító 26083-131173 Státusz Csomag átadva a futárszolgálatnak kiszállításhoz. A következő átadáskor átadják a futárszolgálat részére. Csomagszám 103365121467000013605231 expressone.hu',
  }), null);

  assert.equal(parseMerchantPreAdviceEmail({
    senderDomains: ['jatektenger.hu'],
    subject: 'Játéktenger - Megrendelés státusz módosítás',
    bodyText: 'Azonosító 26083-131173 Státusz Csomag átadva a futárszolgálatnak kiszállításhoz. A következő átadáskor átadják a futárszolgálat részére.',
  }), null);
});
