import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from './email-document.js';
import { evaluateUniversalCommerceSemanticsV1 } from './universal-commerce-semantics-v1.js';

function email(input: { subject: string; html: string }): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'semantic-test-1',
    subject: input.subject,
    from: [{ email: 'orders@unknown-shop.example', name: 'Unknown Shop' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-24T19:40:00.000Z',
    bodyHtml: input.html,
    folders: ['inbound'],
    attachments: [],
  };
}

test('Hungarian visible shipment handoff and English Woo-style HTML converge on one semantic meaning', () => {
  const result = evaluateUniversalCommerceSemanticsV1(buildEmailDocumentV1(email({
    subject: 'A csomagod átadtuk a futárszolgálatnak',
    html: `
      <div class="woocommerce-order-details">
        <h2>Rendelés #19997</h2>
        <table class="woocommerce-table order_details">
          <tr class="woocommerce-table__line-item order_item">
            <td class="product-name">Termék</td>
            <td class="product-quantity">1</td>
          </tr>
        </table>
        <div class="shipping_method">DPD házhozszállítás</div>
        <div class="payment_method">Utánvétes fizetés</div>
        <p>A csomagod átadtuk a futárszolgálatnak.</p>
      </div>
    `,
  })));

  assert.ok(result.objects.includes('ORDER'));
  assert.ok(result.objects.includes('SHIPMENT'));
  assert.ok(result.objects.includes('PRODUCT'));
  assert.ok(result.objects.includes('CARRIER'));
  assert.ok(result.actions.includes('HANDOFF_TO_CARRIER'));
  assert.ok(result.modifiers.includes('COMPLETED'));
  assert.ok(result.technicalEvidence.includes('technical_order'));
  assert.ok(result.technicalEvidence.includes('technical_product'));
  assert.ok(result.technicalEvidence.includes('technical_shipment'));
  assert.ok(result.corroboratedEvidence.includes('visible_plus_technical_order'));
});

test('German unknown-shop text plus English technical markers maps to the same shared concepts', () => {
  const result = evaluateUniversalCommerceSemanticsV1(buildEmailDocumentV1(email({
    subject: 'Ihre Bestellung wurde bestätigt',
    html: `
      <section data-order-id="DE-88271" class="order-summary">
        <div class="line_item product-name">Bohrmaschine</div>
        <div class="payment_method">card</div>
        <a href="https://shop.example/orders/DE-88271">Bestellung ansehen</a>
        <p>Ihre Bestellung wurde bestätigt.</p>
      </section>
    `,
  })));

  assert.ok(result.objects.includes('ORDER'));
  assert.ok(result.objects.includes('PRODUCT'));
  assert.ok(result.objects.includes('PAYMENT'));
  assert.ok(result.actions.includes('CONFIRM'));
  assert.ok(result.technicalEvidence.includes('technical_order'));
  assert.ok(result.technicalEvidence.includes('url_order'));
  assert.ok(result.corroboratedEvidence.includes('visible_plus_technical_order'));
});

test('technical order-looking CSS alone stays technical evidence and does not invent a completed action', () => {
  const result = evaluateUniversalCommerceSemanticsV1(buildEmailDocumentV1(email({
    subject: 'Heti ajánlataink',
    html: `
      <style>.order_item { display:block }</style>
      <div class="order_item product-name">Nézd meg új termékeinket</div>
      <a href="https://shop.example/order-status">Részletek</a>
    `,
  })));

  assert.ok(result.objects.includes('ORDER'));
  assert.equal(result.actions.includes('CREATE'), false);
  assert.equal(result.actions.includes('CONFIRM'), false);
  assert.equal(result.actions.includes('HANDOFF_TO_CARRIER'), false);
  assert.equal(result.corroboratedEvidence.includes('visible_plus_technical_order'), false);
});

test('future carrier handoff is represented separately from completed shipment', () => {
  const result = evaluateUniversalCommerceSemanticsV1(buildEmailDocumentV1(email({
    subject: 'Rendelésed összekészítés alatt',
    html: `
      <div data-order-id="A-7821" class="order-summary shipping_method">
        <p>Rendelésedet összekészítjük, hamarosan átadjuk a futárnak.</p>
      </div>
    `,
  })));

  assert.ok(result.objects.includes('ORDER'));
  assert.ok(result.actions.includes('PACK'));
  assert.ok(result.actions.includes('HANDOFF_TO_CARRIER'));
  assert.ok(result.modifiers.includes('FUTURE'));
});

test('semantic result exposes labels only and no raw order identity', () => {
  const result = evaluateUniversalCommerceSemanticsV1(buildEmailDocumentV1(email({
    subject: 'Order confirmation #ZX-991881',
    html: '<div data-order-id="ZX-991881" class="order-summary">Your order is confirmed.</div>',
  })));
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('ZX-991881'), false);
  assert.ok(result.objects.includes('ORDER'));
  assert.ok(result.actions.includes('CONFIRM'));
});
