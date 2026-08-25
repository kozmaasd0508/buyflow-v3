import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { extractExplicitOrderRelation } from './explicit-order-relation.js';
import { PHASE_C_INDEPENDENT_BLIND_FIXTURES } from './phase-c-independent-blind-fixtures.js';

function document(subject: string, text: string): EmailDocumentV1 {
  return {
    schemaVersion: 1,
    provider: 'blind-fixture',
    providerMessageId: 'blind-message',
    receivedAt: '2026-08-25T20:30:00.000Z',
    sender: {
      addresses: [{ email: 'orders@independent-example.test', name: 'Independent Shop' }],
      domains: ['independent-example.test'],
      primaryEmail: 'orders@independent-example.test',
      primaryDomain: 'independent-example.test',
      primaryName: 'Independent Shop',
    },
    recipients: { to: [], cc: [], bcc: [] },
    subject,
    text,
    html: null,
    headers: [],
    attachments: [],
    sections: [],
    signals: {
      orderNumbers: [],
      amounts: [],
      shippingAmounts: [],
      codAmounts: [],
      products: [],
      couriers: [],
      paymentMethods: [],
      shippingMethods: [],
      trackingNumbers: [],
    },
  };
}

for (const fixture of PHASE_C_INDEPENDENT_BLIND_FIXTURES) {
  test(`Phase C independent blind: ${fixture.id}`, () => {
    const result = extractExplicitOrderRelation(
      document(fixture.subject, fixture.body),
      fixture.currentOrderId,
    );

    if (fixture.expected.kind === 'none') {
      assert.equal(result.relation, null);
      assert.equal(result.conflicts.length, 0);
      return;
    }

    if (fixture.expected.kind === 'conflict') {
      assert.equal(result.relation, null);
      assert.ok(result.conflicts.some((conflict) => conflict.field === 'order_relation' && conflict.severity === 'hard'));
      return;
    }

    assert.ok(result.relation);
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.relation.relation, fixture.expected.relation);
    assert.equal(result.relation.parentOrderIdNormalized, fixture.expected.parent);
    assert.equal(result.relation.childOrderIdNormalized, fixture.expected.child);
  });
}
