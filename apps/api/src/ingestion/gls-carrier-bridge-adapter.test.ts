import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGlsLifecycleEmail, resolveGlsPurchaseBridge } from './gls-carrier-bridge-adapter.js';

const tracking = '3412614699';

const preAdviceBody = `Kedves Kozma Gábor!
Ezúton értesítünk, hogy partnerünk csomago(ka)t készített össze számodra.
A csomago(ka)t a feladást követő munkanapon megkíséreljük kézbesíteni.
Feladó:
Ars Una Studio Kft.
Csomagszám:
${tracking}
Utánvét összege:
8265 HUF
Tervezett kézbesítés:
2026. 08. 04.
(Amennyiben partnerünk ma feladja a csomago(ka)t.)`;

test('parses GLS pre-advice without claiming physical shipment progress', () => {
  const result = parseGlsLifecycleEmail({
    from: [{ email: 'noreply@gls-hungary.com' }],
    subject: 'GLS csomag információ / GLS parcel information',
    bodyText: preAdviceBody,
  });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'shipment_created');
  assert.equal(result.extraction.event_type, 'shipment');
  assert.equal(result.extraction.tracking_number, tracking);
  assert.equal(result.extraction.parcel_sender, 'Ars Una Studio Kft.');
  assert.equal(result.extraction.cod_amount, 8265);
  assert.equal(result.extraction.cod_currency, 'HUF');
});

test('parses GLS delivery-today as out_for_delivery, never delivered', () => {
  const result = parseGlsLifecycleEmail({
    from: [{ email: 'noreply@gls-hungary.com' }],
    subject: `GLS ${tracking} mai kézbesítése / GLS ${tracking} delivery today`,
    bodyText: `Ezúton értesítünk, hogy partnerünk által feladott csomago(ka)t a mai napon megkíséreljük kézbesíteni.
Utánvét összeg:
8265 HUF
Feladó:
Ars Una Studio Kft.
Csomagszám:
${tracking}`,
  });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'out_for_delivery');
  assert.equal(result.extraction.event_type, 'shipment');
});

test('extracts dynamic GLS tracking from RTT URL and keeps conservative in_transit phase', () => {
  const result = parseGlsLifecycleEmail({
    from: [{ email: 'noreply@gls-hungary.com' }],
    subject: 'Dinamikus csomagkövetés - GLS',
    bodyText: `Dinamikus csomagkövető szolgáltatásunk segítségével folyamatosan nyomon követheti csomagja várható kézbesítési időpontját.
Csomagom nyomonkövetése [URL: https://gls-rtt.com/?utm_source=invite-email#/HU/hu/${tracking}]`,
  });
  assert.ok(result);
  assert.equal(result.shipmentPhase, 'in_transit');
  assert.equal(result.extraction.tracking_number, tracking);
  assert.equal(result.extraction.parcel_sender, null);
});

test('rejects GLS lookalike sender', () => {
  assert.equal(parseGlsLifecycleEmail({
    from: [{ email: 'noreply@gls-hungary.com.attacker.example' }],
    subject: 'GLS csomag információ / GLS parcel information',
    bodyText: preAdviceBody,
  }), null);
});

test('links only one exact merchant + COD + recent purchase candidate and tolerates only one HUF difference', () => {
  const result = resolveGlsPurchaseBridge({
    parcelSender: 'Ars Una Studio Kft.',
    codAmount: 8265,
    codCurrency: 'HUF',
    receivedAt: '2026-08-03T10:18:05.000Z',
    candidates: [{
      purchaseId: 'p1',
      merchantName: 'Ars Una Studio Kft.',
      merchantLegalName: null,
      merchantDomain: 'arsuna.hu',
      orderNumber: '192132',
      subtotal: 6276,
      shippingAmount: 1990,
      discountAmount: null,
      totalAmount: null,
      currency: null,
      paymentMethod: 'Utánvéttel',
      expectedCarrier: null,
      orderedAt: '2026-08-02T15:31:04.000Z',
    }],
  });
  assert.equal(result.decision, 'linkable');
  assert.equal(result.purchaseId, 'p1');
  assert.ok(result.reasons.includes('cod_amount_within_one_unit'));
});

test('does not link when the same sender and amount match multiple recent purchases', () => {
  const candidate = {
    merchantName: 'Ars Una Studio Kft.', merchantLegalName: null, merchantDomain: 'arsuna.hu', orderNumber: '192132',
    subtotal: 6276, shippingAmount: 1990, discountAmount: null, totalAmount: null, currency: null,
    paymentMethod: 'Utánvéttel', expectedCarrier: null, orderedAt: '2026-08-02T15:31:04.000Z',
  };
  const result = resolveGlsPurchaseBridge({
    parcelSender: 'Ars Una Studio Kft.', codAmount: 8265, codCurrency: 'HUF', receivedAt: '2026-08-03T10:18:05.000Z',
    candidates: [{ purchaseId: 'p1', ...candidate }, { purchaseId: 'p2', ...candidate, orderNumber: '192133' }],
  });
  assert.equal(result.decision, 'review');
  assert.equal(result.purchaseId, null);
});

test('does not link a non-COD or amount-mismatched purchase', () => {
  const result = resolveGlsPurchaseBridge({
    parcelSender: 'Ars Una Studio Kft.', codAmount: 8265, codCurrency: 'HUF', receivedAt: '2026-08-03T10:18:05.000Z',
    candidates: [{
      purchaseId: 'p1', merchantName: 'Ars Una Studio Kft.', merchantLegalName: null, merchantDomain: 'arsuna.hu', orderNumber: '192132',
      subtotal: 6000, shippingAmount: 1990, discountAmount: null, totalAmount: 7990, currency: 'HUF',
      paymentMethod: 'bankkártya', expectedCarrier: 'GLS', orderedAt: '2026-08-02T15:31:04.000Z',
    }],
  });
  assert.equal(result.decision, 'review');
});
