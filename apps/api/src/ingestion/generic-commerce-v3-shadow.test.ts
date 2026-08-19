import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { parseNormalizedDeterministicEmail } from './normalized-email-deterministic.js';

function email(input: { sender: string; subject: string; body: string }): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: `${input.subject}@test`,
    subject: input.subject,
    from: [{ email: input.sender }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-19T20:00:00.000Z',
    snippet: input.body,
    folders: ['inbox'],
    attachments: [],
  };
}

const positiveCases = [
  {
    sender: 'info@fnp.hu',
    subject: 'A FNP Products rendelésed teljesített. Rendelésed átadtuk a futárnak.',
    body: 'A 46789 számú rendelésed átadtuk a futárnak a kézbesítéshez.',
    event: 'shipment',
  },
  {
    sender: 'noreply@dpd.hu',
    subject: 'Értesítés 16380143879559 sikeres kézbesítéséről',
    body: 'Értesítjük, hogy 16380143879559 küldeményét a mai napon sikeresen kézbesítettük.',
    event: 'delivery',
  },
  {
    sender: 'noreply@barion.com',
    subject: 'Sikeres fizetés',
    body: 'Sikeresen fizettél 26 234 Ft-ot bankkártyával.',
    event: 'payment_completed',
  },
  {
    sender: 'info@jatekbolt.hu',
    subject: 'Megrendelési szám: #12247833',
    body: 'Megrendelésed köszönjük, a csomagod átadtuk a DPD futárszolgálatnak.',
    event: 'shipment',
  },
  {
    sender: 'noreply@gls-hungary.com',
    subject: 'Dinamikus csomagkövetés - GLS',
    body: 'Dinamikus csomagkövető szolgáltatásunk segítségével folyamatosan nyomon követheti csomagja várható kézbesítési időpontját.',
    event: 'shipment',
  },
  {
    sender: 'arsuna@arsuna.hu',
    subject: 'Ars Una számlája érkezett',
    body: 'Mellékelten küldjük az 5133964 számú számláját.',
    event: 'invoice_or_receipt',
  },
  {
    sender: 'webshop@arsuna.hu',
    subject: 'Ars Una Studio Kft.: #192132 számú rendelése létrejött',
    body: 'Köszönjük rendelését! Megkezdtük a rendelés feldolgozását.',
    event: 'order_created',
  },
  {
    sender: 'noreply@sinsay.com',
    subject: 'Visszaigazolás arról, hogy a 15710474710 rendelést elküldték.',
    body: 'A rendelés elküldve - A megrendelését elküldtük.',
    event: 'shipment',
  },
  {
    sender: 'noreply@sinsay.com',
    subject: 'A 15710474710 számú rendelésed készen áll a szállításra.',
    body: 'A rendelés be van csomagolva, és várja a futár általi átvételt.',
    event: 'shipment',
  },
  {
    sender: 'noreply@sinsay.com',
    subject: 'A 15710474710 számú rendelésedet csomagolják.',
    body: 'Elkezdtük csomagolni a megrendelésedet.',
    event: 'shipment',
  },
  {
    sender: 'DoNotReply@mcdonalds.com',
    subject: 'Fizetés megerősítése',
    body: 'Ez egy rendelés összesítő. A nyugtát akkor fogod megkapni, amikor átveszed rendelésed.',
    event: 'payment_completed',
  },
] as const;

for (const row of positiveCases) {
  test(`generic v3 recognizes ${row.subject}`, () => {
    const result = parseNormalizedDeterministicEmail(email(row));
    assert.ok(result);
    assert.equal(result.extraction.event_type, row.event);
  });
}

const noiseCases = [
  {
    sender: 'no-reply@expressone.hu',
    subject: 'Expressone értesítés #772013',
    body: 'Köszönjük megrendelését, amelyet rendszerünkben rögzítettünk a #772013 azonosító alatt. A megrendelt árufelvételi napra nincs feladásra váró küldeménye esetén kérjük az árufelvétel lemondását.',
  },
  {
    sender: 'no-reply@expressone.hu',
    subject: 'Expressone értesítés',
    body: 'Az "772013" azonosítóval rögzített árufelvétel státusza megváltozott: a megbízást a futár elfogadta.',
  },
  {
    sender: 'info@expressone.hu',
    subject: 'Kézbesítéssel kapcsolatos információk',
    body: 'Átmeneti fennakadások érinthetik egyes kézbesítéseinket.',
  },
  {
    sender: 'noreply@gls-hungary.com',
    subject: 'GLS elégedettségi kérdőív',
    body: 'Köszönjük, hogy a csomagszállításhoz a GLS-t választotta! Visszajelzése segíti a munkánkat.',
  },
  {
    sender: 'velemeny@adat.dpd.hu',
    subject: 'Ajánlaná a DPD szolgáltatásait másoknak?',
    body: 'Bízunk benne, hogy elégedett volt legutóbbi DPD-s kézbesítési élményével.',
  },
  {
    sender: 'message@message.sinsay.com',
    subject: 'Ingyenes szállítás MINDENRE 🚚',
    body: 'Ne fizess a tanszerek szállításáért!',
  },
] as const;

for (const row of noiseCases) {
  test(`generic v3 keeps noise negative: ${row.subject}`, () => {
    const result = parseNormalizedDeterministicEmail(email(row));
    assert.equal(result, null);
  });
}
