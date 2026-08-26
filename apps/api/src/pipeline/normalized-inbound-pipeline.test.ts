import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import {
  persistNormalizedInboundEmail,
  planNormalizedInboundEmail,
} from './normalized-inbound-pipeline.js';

function email(overrides: Partial<NormalizedEmail> = {}): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'ses-1',
    subject: 'Your parcel has been shipped',
    from: [{ email: 'noreply@gls-hungary.com', name: 'GLS' }],
    to: [{ email: 'kozma0508@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-18T18:00:00.000Z',
    bodyHtml: '<p>Tracking number: 12345678</p><p>Your parcel has been shipped.</p>',
    folders: ['inbound'],
    attachments: [],
    ...overrides,
  };
}

test('accepted SES email reaches the deterministic motor with zero AI dependency', () => {
  const plan = planNormalizedInboundEmail({
    email: email(),
    security: {
      disposition: 'accept',
      signals: { spam: 'PASS', virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' },
    },
  });

  assert.equal(plan.status, 'recognized');
  assert.equal(plan.classification, 'shipment');
  assert.equal(plan.parserVersion, 'deterministic-commerce-v2');
  assert.equal(plan.validatedResult?.tracking_number, '12345678');
  assert.equal(plan.validatedResult?.shipment_phase, 'shipped');
  assert.equal(plan.structuredResult.ingestion_source, 'normalized-inbound');
  assert.equal(plan.structuredResult.shopping_email_purpose, 'shopping_only');
});

test('virus reject stops before deterministic recognition', () => {
  const plan = planNormalizedInboundEmail({
    email: email(),
    security: {
      disposition: 'reject',
      signals: { spam: 'PASS', virus: 'FAIL', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' },
    },
  });

  assert.equal(plan.status, 'security_rejected');
  assert.equal(plan.processingStatus, 'ignored');
  assert.equal(plan.validatedResult, null);
  assert.equal(plan.classification, 'security_rejected');
});

test('spam quarantine cannot create transactional evidence', () => {
  const plan = planNormalizedInboundEmail({
    email: email(),
    security: {
      disposition: 'quarantine',
      signals: { spam: 'FAIL', virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' },
    },
  });

  assert.equal(plan.status, 'quarantined');
  assert.equal(plan.processingStatus, 'review');
  assert.equal(plan.validatedResult, null);
  assert.equal(plan.classification, 'security_quarantine');
});

test('strong promotional shopping-address noise is ignored instead of entering REVIEW', () => {
  const plan = planNormalizedInboundEmail({
    email: email({
      subject: 'Exkluzív ajánlat - új kollekció',
      from: [{ email: 'news@shop.example', name: 'Shop' }],
      bodyHtml: '<p>Fedezd fel az új kollekciót. Vásárolj újra! Kuponkód: SAVE20.</p>',
    }),
  });

  assert.equal(plan.status, 'non_commerce_ignored');
  assert.equal(plan.processingStatus, 'ignored');
  assert.equal(plan.classification, 'non_commerce');
  assert.equal(plan.validatedResult, null);
  assert.equal(plan.structuredResult.stored, false);
});

test('real order confirmation is not discarded just because marketing text is present', () => {
  const plan = planNormalizedInboundEmail({
    email: email({
      subject: 'Order confirmation #123456 - exclusive offer inside',
      from: [{ email: 'orders@new-shop.example', name: 'New Shop' }],
      bodyHtml: '<p>Thank you for your order.</p><p>Order number: 123456</p><p>Shop now and use coupon code NEXT10.</p>',
    }),
  });

  assert.notEqual(plan.status, 'non_commerce_ignored');
});

test('unknown mail remains review instead of guessing or dropping it', () => {
  const plan = planNormalizedInboundEmail({
    email: email({
      subject: 'Weekly news',
      from: [{ email: 'hello@example.com' }],
      bodyHtml: '<p>Read our latest stories.</p>',
    }),
  });

  assert.equal(plan.status, 'review');
  assert.equal(plan.classification, null);
  assert.equal(plan.validatedResult, null);
  assert.equal(plan.structuredResult.reason, 'no_deterministic_match');
});

test('proven non-commerce mail is not persisted in source_emails', async () => {
  const touchedTables: string[] = [];
  const db = {
    from(table: string) {
      touchedTables.push(table);
      if (table !== 'email_connections') {
        throw new Error(`Unexpected table access: ${table}`);
      }
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          return {
            data: {
              id: 'connection-1',
              user_id: 'user-1',
              email_address: 'kozma0508@buyflow.hu',
            },
            error: null,
          };
        },
      };
      return query;
    },
  };

  const result = await persistNormalizedInboundEmail({
    db,
    recipientAddress: 'kozma0508@buyflow.hu',
    email: email({
      subject: 'Exkluzív ajánlat - új kollekció',
      from: [{ email: 'news@shop.example', name: 'Shop' }],
      bodyHtml: '<p>Fedezd fel az új kollekciót. Vásárolj újra! Kuponkód: SAVE20.</p>',
    }),
  });

  assert.equal(result.status, 'non_commerce_ignored');
  assert.equal(result.classification, 'non_commerce');
  assert.equal(result.sourceEmailId, undefined);
  assert.deepEqual(touchedTables, ['email_connections']);
  assert.equal(result.purchaseWrites, 0);
  assert.equal(result.shipmentWrites, 0);
  assert.equal(result.documentWrites, 0);
  assert.equal(result.aiCalls, 0);
});

test('generic order recognition remains shadow-only and cannot become production eligible', () => {
  const plan = planNormalizedInboundEmail({
    email: email({
      subject: 'Order confirmation #123456',
      from: [{ email: 'orders@new-shop.example' }],
      bodyHtml: '<p>Thank you for your order.</p><p>Order number: 123456</p>',
    }),
  });

  if (plan.parserVersion?.startsWith('generic-order-confirmation-v')) {
    assert.equal(plan.status, 'review');
    assert.equal(plan.validatedResult?.eligible_for_purchase_creation, false);
    assert.equal(plan.validatedResult?.shadow_only, true);
    assert.equal(plan.validatedResult?.would_write, false);
  } else {
    assert.equal(plan.status, 'review');
  }
});
