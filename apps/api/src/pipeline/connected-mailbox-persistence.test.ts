import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { persistNormalizedEmailForResolvedRecipient } from './normalized-inbound-pipeline.js';

function promotionalGmail(): NormalizedEmail {
  return {
    provider: 'gmail',
    providerMessageId: 'gmail-noise-1',
    subject: 'Exkluzív ajánlat - új kollekció',
    from: [{ email: 'news@shop.example', name: 'Shop' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-30T20:00:00.000Z',
    bodyHtml: '<p>Fedezd fel az új kollekciót. Vásárolj újra! Kuponkód: SAVE20.</p>',
    folders: ['INBOX'],
    attachments: [],
  };
}

test('trusted connected mailbox bypasses address resolution without gaining commerce writes', async () => {
  const db = {
    from(table: string) {
      throw new Error(`Non-commerce direct mailbox path must not touch DB table ${table}`);
    },
  };
  const result = await persistNormalizedEmailForResolvedRecipient({
    db,
    recipient: {
      userId: 'user-1',
      emailConnectionId: 'gmail-connection-1',
      emailAddress: 'buyer@example.com',
    },
    email: promotionalGmail(),
  });

  assert.equal(result.status, 'non_commerce_ignored');
  assert.equal(result.recipient?.emailConnectionId, 'gmail-connection-1');
  assert.equal(result.sourceEmailId, undefined);
  assert.equal(result.purchaseWrites, 0);
  assert.equal(result.shipmentWrites, 0);
  assert.equal(result.documentWrites, 0);
  assert.equal(result.aiCalls, 0);
});
