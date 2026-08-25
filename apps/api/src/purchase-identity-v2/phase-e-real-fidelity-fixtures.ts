export type PhaseERealFidelityExpectation =
  | { kind: 'eligible_create_purchase'; expectedOrderId: string }
  | { kind: 'eligible_link_event'; expectedPurchaseId: string }
  | { kind: 'blocked' };

export interface PhaseERealFidelityFixture {
  id: string;
  snapshotKey: 'empty' | 'gate-order';
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  expectation: PhaseERealFidelityExpectation;
}

/**
 * Second replay of the same fixed July 2026 source classes.
 *
 * Privacy boundary:
 * - public merchant/provider names and domains may be preserved because they are
 *   part of deterministic source authority;
 * - user names, recipient addresses, physical addresses, Gmail ids, real order
 *   ids, real tracking ids, payment references and card details are removed;
 * - every transactional identifier below is synthetic.
 *
 * Phase E production code remains frozen at a4fc8a50f5b950287fff1ce05389a2755531883f.
 */
export const PHASE_E_REAL_FIDELITY_FIXTURES: PhaseERealFidelityFixture[] = [
  {
    id: 'rf-01-express-one-service-info',
    snapshotKey: 'empty',
    senderName: 'Express One',
    senderEmail: 'info@expressone.hu',
    subject: 'Kézbesítéssel kapcsolatos információk',
    body: 'Kedves Ügyfelünk! Átmeneti fennakadások miatt egyes kézbesítések késhetnek. Ez általános szolgáltatási tájékoztató.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-02-mvm-payment-demand',
    snapshotKey: 'empty',
    senderName: 'MVM Next',
    senderEmail: 'ugyfelszolgalat@mvmnext.hu',
    subject: 'E fizetési felszólító',
    body: 'Tisztelt Ügyfelünk! Szolgáltatói számlájával kapcsolatban fizetési felszólító készült.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-03-express-one-newsletter',
    snapshotKey: 'empty',
    senderName: 'Express One',
    senderEmail: 'info@expressone.hu',
    subject: 'Nézd meg, mi történt velünk júliusban!',
    body: 'Havi hírlevelünkben bemutatjuk csapatunk híreit és nemzetközi elismeréseinket.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-04-deconline-seasonal-newsletter',
    snapshotKey: 'empty',
    senderName: 'DECOnline',
    senderEmail: 'info@deconline.hu',
    subject: 'Egy csipetnyi ősz - dekorok az új szezonra',
    body: 'Új szezon, új hangulat. Megérkeztek az őszi dekorációk és szezonális újdonságok.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-05-foxpost-locker-arrival',
    snapshotKey: 'gate-order',
    senderName: 'FOXPOST',
    senderEmail: 'noreply@foxpost.hu',
    subject: 'Csomagod megérkezett',
    body: 'Ezúton értesítünk, hogy gate.shop által feladott csomagod megérkezett a csomagautomatába és átvehető. Csomagod azonosítószáma: FXP-TEST-90427163.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-06-foxpost-warehouse',
    snapshotKey: 'gate-order',
    senderName: 'FOXPOST',
    senderEmail: 'noreply@foxpost.hu',
    subject: 'Csomagod már a raktárunkban van',
    body: 'Csomagod, amelyet gate.shop adott fel számodra, beérkezett raktárunkba. Csomagod azonosítószáma: FXP-TEST-90427163.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-07-packeta-accepted-transport',
    snapshotKey: 'gate-order',
    senderName: 'Packeta',
    senderEmail: 'info@packeta.hu',
    subject: 'A szállítmányt elfogadták a szállításra',
    body: 'Tisztelt Ügyfelünk! gate.shop átadta nekünk az alábbi küldeményt szállításra. Csomagja Z-száma Z 555 1234 987.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-08-prime-video-trial',
    snapshotKey: 'empty',
    senderName: 'Prime Video',
    senderEmail: 'no-reply@primevideo.com',
    subject: 'A Prime Video ingyenes próbaidőszaka megkezdődött',
    body: 'Gratulálunk, megkezdődött a Prime Video ingyenes próbaidőszaka.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-09-gate-shipped-same-order',
    snapshotKey: 'gate-order',
    senderName: 'gate.shop',
    senderEmail: 'noreply@gate.shop',
    subject: 'Megrendelésének elküldése',
    body: 'gate.shop\nJó napot kívánunk!\n90427163 számú megrendelését átadtuk a kiszállítónak, hamarosan megérkezik Önhöz.\nrendelés részlete\n90427163\nrendelés dátuma\n28. 07. 2026\nfizetés\nUtánvéttel\nkézbesítés\nFOXPOST',
    expectation: { kind: 'eligible_link_event', expectedPurchaseId: 'p-gate' },
  },
  {
    id: 'rf-10-day-one-newsletter',
    snapshotKey: 'empty',
    senderName: 'Day One Capital',
    senderEmail: 'dayonecapital@substack.com',
    subject: 'Why we invested in imagi',
    body: 'A portfolio company raised a seed round. This is an investment newsletter delivered to subscribers.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-11-barion-payment-success-unanchored',
    snapshotKey: 'empty',
    senderName: 'Barion',
    senderEmail: 'noreply@barion.com',
    subject: 'Sikeres fizetés',
    body: 'Sikeresen fizettél 25734 Ft-ot bankkártyával. Elfogadóhely neve: Example Telecom. Rendelés, szállítás vagy visszatérítés kapcsán keresd a kereskedőt.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-12-foxpost-pre-advice',
    snapshotKey: 'gate-order',
    senderName: 'FOXPOST',
    senderEmail: 'noreply@foxpost.hu',
    subject: 'Előértesítés',
    body: 'A rendszerünkben egy csomag feladásához szükséges csomagszámot hoztak létre. A csomagot még nem adták át a FOXPOST részére. Csomagszám: FXP-TEST-90427163.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-13-gate-order-confirmed',
    snapshotKey: 'empty',
    senderName: 'gate.shop',
    senderEmail: 'noreply@gate.shop',
    subject: 'Köszönjük, hogy a Gate-nél vásárolt.',
    body: 'gate.shop\nJó napot kívánunk!\nköszönjük, hogy a gate.shop-nál vásárolt. 90427163 számú megrendelését fogadtuk és küldésekor felvesszük Önnel a kapcsolatot.\nrendelés részlete\n90427163\nrendelés dátuma\n28. 07. 2026\nfizetés\nUtánvéttel\nvégösszeg\n12535 Ft\nkézbesítés\nFOXPOST',
    expectation: { kind: 'eligible_create_purchase', expectedOrderId: '90427163' },
  },
  {
    id: 'rf-14-gate-loyalty-credit',
    snapshotKey: 'empty',
    senderName: 'gate.shop',
    senderEmail: 'noreply@gate.shop',
    subject: 'Hűségpontjaid jóváírásra kerültek',
    body: 'Köszönjük, hogy a GATE-nél vásárolt. Az ügyfélfiókjában hűségpontokat írtunk jóvá egy korábbi elszámolt rendelés és visszaküldött áru alapján.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-15-mcdonalds-mobile-order-summary',
    snapshotKey: 'empty',
    senderName: "McDonald's",
    senderEmail: 'noreply@mcdonalds.hu',
    subject: 'Mobil rendelés összesítő',
    body: 'Ez egy rendelés összesítő. A nyugtát akkor kapod meg, amikor átveszed rendelésed. Dátum: 26/07/26 12:53. Végösszeg: 13370 Ft.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rf-16-zentrada-reengagement',
    snapshotKey: 'empty',
    senderName: 'Zentrada',
    senderEmail: 'service@zentrada.eu',
    subject: 'Barátságos üdvözlet és egy kis ajándék a hosszú szünet után',
    body: 'Már jó idő eltelt az utolsó látogatása óta. Egy kis kedvezménnyel várjuk vissza platformunkra.',
    expectation: { kind: 'blocked' },
  },
];
