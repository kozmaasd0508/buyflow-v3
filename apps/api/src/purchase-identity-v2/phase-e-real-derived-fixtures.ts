export type PhaseERealDerivedExpectation =
  | { kind: 'eligible_create_purchase'; expectedOrderId: string }
  | { kind: 'eligible_link_event'; expectedPurchaseId: string }
  | { kind: 'blocked' };

export interface PhaseERealDerivedFixture {
  id: string;
  sourceClass:
    | 'carrier_service_notice'
    | 'utility_payment_notice'
    | 'carrier_newsletter'
    | 'retail_newsletter'
    | 'carrier_arrived_locker'
    | 'carrier_warehouse'
    | 'carrier_accepted_transport'
    | 'subscription_trial'
    | 'merchant_shipped'
    | 'investment_newsletter'
    | 'payment_success'
    | 'carrier_pre_advice'
    | 'merchant_order_confirmed'
    | 'loyalty_credit'
    | 'mobile_order_summary'
    | 'b2b_reengagement';
  snapshotKey: 'empty' | 'cedar-order';
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  expectation: PhaseERealDerivedExpectation;
}

/**
 * Frozen before the first Phase E replay execution.
 *
 * These 16 fixtures preserve only the transactional semantics and ordering of a
 * fixed, previously unseen July 2026 Gmail sample selected before message
 * contents were inspected. All user PII, Gmail ids, real order/tracking/payment
 * identifiers, addresses and message-specific private details were removed or
 * replaced. The public repository intentionally cannot reconstruct the source
 * mailbox messages from these fixtures.
 *
 * The Phase E production code was already merged/frozen before the source sample
 * was selected. This is therefore a post-freeze fresh real-derived replay, not a
 * claim that the fixture author was blind to the message text.
 */
export const PHASE_E_REAL_DERIVED_FIXTURES: PhaseERealDerivedFixture[] = [
  {
    id: 'rd-01-carrier-service-delay-notice',
    sourceClass: 'carrier_service_notice',
    snapshotKey: 'empty',
    senderName: 'Parcel Express',
    senderEmail: 'info@parcel-express.example',
    subject: 'Kézbesítéssel kapcsolatos információk',
    body: 'Kedves Ügyfelünk! Átmeneti fennakadások miatt egyes kézbesítések késhetnek. Ez általános tájékoztató, nem egy konkrét csomag értesítése.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-02-utility-payment-demand',
    sourceClass: 'utility_payment_notice',
    snapshotKey: 'empty',
    senderName: 'Utility Online Service',
    senderEmail: 'online@utility-service.example',
    subject: 'E fizetési felszólító',
    body: 'Tisztelt Ügyfelünk! Szolgáltatói számlájával kapcsolatban fizetési felszólító készült, amelyet mellékletben küldünk.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-03-carrier-monthly-newsletter',
    sourceClass: 'carrier_newsletter',
    snapshotKey: 'empty',
    senderName: 'Parcel Express',
    senderEmail: 'info@parcel-express.example',
    subject: 'Nézd meg, mi történt velünk júliusban!',
    body: 'Havi hírlevelünkben bemutatjuk csapatunk híreit és nemzetközi elismeréseinket. Kövesd a Parcel Express híreit!',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-04-retail-seasonal-newsletter',
    sourceClass: 'retail_newsletter',
    snapshotKey: 'empty',
    senderName: 'Autumn Decor',
    senderEmail: 'hello@autumn-decor.example',
    subject: 'Egy csipetnyi ősz - dekorok az új szezonra',
    body: 'Új szezon, új hangulat. Megérkeztek az őszi dekorációk, illatgyertyák és szezonális újdonságok.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-05-carrier-arrived-locker',
    sourceClass: 'carrier_arrived_locker',
    snapshotKey: 'cedar-order',
    senderName: 'ParcelBox',
    senderEmail: 'no-reply@parcelbox.example',
    subject: 'Csomagod megérkezett',
    body: 'Ezúton értesítünk, hogy Cedar Gate Shop által feladott csomagod megérkezett a csomagautomatába és átvehető. Átvételi információkat külön üzenetben küldünk.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-06-carrier-warehouse',
    sourceClass: 'carrier_warehouse',
    snapshotKey: 'cedar-order',
    senderName: 'ParcelBox',
    senderEmail: 'no-reply@parcelbox.example',
    subject: 'Csomagod már a raktárunkban van',
    body: 'Csomagod, amelyet Cedar Gate Shop adott fel számodra, beérkezett raktárunkba. Hamarosan továbbítjuk a kiválasztott csomagautomatába.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-07-carrier-accepted-transport',
    sourceClass: 'carrier_accepted_transport',
    snapshotKey: 'cedar-order',
    senderName: 'Parcel Network',
    senderEmail: 'noreply@parcel-network.example',
    subject: 'A szállítmányt elfogadták a szállításra',
    body: 'Tisztelt Ügyfelünk! Cedar Gate Shop átadta nekünk az alábbi küldeményt szállításra. Küldeményazonosító: Z 555 7777 111. Szerződéses szállítópartnerünk fogja kézbesíteni.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-08-subscription-trial-started',
    sourceClass: 'subscription_trial',
    snapshotKey: 'empty',
    senderName: 'Stream Prime',
    senderEmail: 'no-reply@stream-prime.example',
    subject: 'Az ingyenes próbaidőszaka megkezdődött',
    body: 'Gratulálunk, megkezdődött a videós szolgáltatás ingyenes próbaidőszaka. Mostantól hozzáférhet a műsorokhoz és filmekhez.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-09-merchant-shipped-same-order',
    sourceClass: 'merchant_shipped',
    snapshotKey: 'cedar-order',
    senderName: 'Cedar Gate Shop',
    senderEmail: 'noreply@cedargate-shop.example',
    subject: 'Megrendelésének elküldése',
    body: 'Jó napot kívánunk! CG20336215 számú megrendelését átadtuk a kiszállítónak, hamarosan megérkezik Önhöz. Rendelés száma: CG20336215. Kézbesítés: ParcelBox.',
    expectation: { kind: 'eligible_link_event', expectedPurchaseId: 'p-cedar' },
  },
  {
    id: 'rd-10-investment-newsletter-delivered-word',
    sourceClass: 'investment_newsletter',
    snapshotKey: 'empty',
    senderName: 'Daylight Ventures',
    senderEmail: 'newsletter@daylight-ventures.example',
    subject: 'Why we invested in a learning startup',
    body: 'Our portfolio company raised a seed round to build a safe education layer. This newsletter was delivered to subscribers after the announcement.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-11-payment-provider-success-unanchored',
    sourceClass: 'payment_success',
    snapshotKey: 'empty',
    senderName: 'CardPay',
    senderEmail: 'noreply@cardpay.example',
    subject: 'Sikeres fizetés',
    body: 'Sikeresen fizettél 25734 Ft-ot bankkártyával. Elfogadóhely neve: Example Telecom. Rendelés, szállítás vagy visszatérítés kapcsán keresd a kereskedőt.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-12-carrier-pre-advice-not-handed-over',
    sourceClass: 'carrier_pre_advice',
    snapshotKey: 'cedar-order',
    senderName: 'ParcelBox',
    senderEmail: 'no-reply@parcelbox.example',
    subject: 'Előértesítés',
    body: 'A rendszerünkben egy csomag feladásához szükséges csomagszámot hoztak létre. A csomagot még nem adták át a ParcelBox részére. Csomagszám: PBX178524111362058.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-13-merchant-order-confirmed',
    sourceClass: 'merchant_order_confirmed',
    snapshotKey: 'empty',
    senderName: 'Cedar Gate Shop',
    senderEmail: 'noreply@cedargate-shop.example',
    subject: 'Köszönjük, hogy nálunk vásárolt.',
    body: 'Jó napot kívánunk! Köszönjük, hogy nálunk vásárolt. CG20336215 számú megrendelését fogadtuk. Rendelés száma: CG20336215. Rendelés dátuma: 28. 07. 2026. Fizetés: utánvéttel. Végösszeg: 12535 Ft. Kézbesítés: ParcelBox.',
    expectation: { kind: 'eligible_create_purchase', expectedOrderId: 'CG20336215' },
  },
  {
    id: 'rd-14-loyalty-credit-old-order',
    sourceClass: 'loyalty_credit',
    snapshotKey: 'empty',
    senderName: 'Cedar Gate Shop',
    senderEmail: 'noreply@cedargate-shop.example',
    subject: 'Hűségpontjaid jóváírásra kerültek',
    body: 'Köszönjük korábbi vásárlásodat. Ügyfélfiókodban hűségpontokat írtunk jóvá egy korábban elszámolt rendelés és visszaküldött áru alapján.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-15-mobile-order-summary-without-stable-id',
    sourceClass: 'mobile_order_summary',
    snapshotKey: 'empty',
    senderName: 'Quick Meal',
    senderEmail: 'donotreply@quick-meal.example',
    subject: 'Mobil rendelés összesítő',
    body: 'Ez egy rendelés összesítő. A nyugtát akkor kapod meg, amikor átveszed rendelésed. Köszönjük, hogy a mobil rendelést választottad. Dátum: 26/07/26 12:53. Végösszeg: 13370 Ft.',
    expectation: { kind: 'blocked' },
  },
  {
    id: 'rd-16-b2b-reengagement',
    sourceClass: 'b2b_reengagement',
    snapshotKey: 'empty',
    senderName: 'Wholesale Network',
    senderEmail: 'account@wholesale-network.example',
    subject: 'Barátságos üdvözlet és egy kis ajándék a hosszú szünet után',
    body: 'Már jó idő eltelt az utolsó látogatása óta. Reméljük, minden jól alakult, és egy kis kedvezménnyel várjuk vissza platformunkra.',
    expectation: { kind: 'blocked' },
  },
];
