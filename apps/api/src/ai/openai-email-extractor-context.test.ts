import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmailWithOpenAIResult, htmlToEvidenceLayout } from './openai-email-extractor.js';

function emptyExtraction() {
  return {
    event_type: 'shipment',
    merchant: null,
    merchant_legal_name: null,
    order_number: null,
    subtotal: null,
    shipping_amount: null,
    discount_amount: null,
    total: null,
    currency: null,
    payment_status: null,
    payment_method: null,
    paid_amount: null,
    paid_currency: null,
    shipping_method: null,
    tracking_number: 'TRACK-1',
    carrier: 'GLS',
    parcel_sender: null,
    cod_amount: null,
    cod_currency: null,
    invoice_number: null,
    products: [],
    confidence: 0.97,
  };
}

test('HTML evidence layout preserves table and cell semantics without scripts', () => {
  const layout = htmlToEvidenceLayout('<script>ignore()</script><table><tr><th>Order</th><td>ORD-1</td></tr></table>');
  assert.match(layout, /\[TABLE\]/);
  assert.match(layout, /\[ROW\]/);
  assert.match(layout, /\[HEADER\] Order/);
  assert.match(layout, /\[CELL\] ORD-1/);
  assert.doesNotMatch(layout, /ignore\(\)/);
});

test('request separates current email structure from read-only prior journey context', async () => {
  let requestBody: any;
  const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ output_text: JSON.stringify(emptyExtraction()) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await extractEmailWithOpenAIResult({
    apiKey: 'test-key',
    model: 'gpt-5.6-luna',
    subject: 'Csomagod úton van',
    fromDomains: ['shop.example'],
    bodyText: 'Tracking number: TRACK-1',
    bodyHtml: '<table><tr><th>Tracking number</th><td>TRACK-1</td></tr></table>',
    structuredEvidence: JSON.stringify({ signals: { trackingNumbers: ['TRACK-1'] } }),
    journeyContext: JSON.stringify({ candidates: [{ purchaseId: 'p1', orderIds: ['OLD-ORDER'] }] }),
    fetchImpl: fakeFetch as typeof fetch,
  });

  assert.match(String(requestBody.input), /CURRENT EMAIL HTML STRUCTURE/);
  assert.match(String(requestBody.input), /CURRENT EMAIL STRUCTURED EVIDENCE/);
  assert.match(String(requestBody.input), /BUYFLOW PRIOR JOURNEY CONTEXT/);
  assert.match(String(requestBody.instructions), /Never copy, restore, infer, or fill merchant/i);
  assert.match(String(requestBody.instructions), /untrusted data/i);
  assert.match(String(requestBody.instructions), /current email itself/i);
});
