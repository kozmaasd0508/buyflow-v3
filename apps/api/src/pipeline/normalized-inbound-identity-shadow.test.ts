import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { persistNormalizedInboundEmail } from './normalized-inbound-pipeline.js';

function email(): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'ses-shadow-1',
    subject: 'Weekly news',
    from: [{ email: 'hello@example.com', name: 'Example' }],
    to: [{ email: 'user@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-23T19:00:00.000Z',
    bodyHtml: '<p>Read our latest stories.</p>',
    folders: ['inbound'],
    attachments: [],
  };
}

test('persists only compact shadow diagnostic and never writes purchase graph entities', async () => {
  const writes: Array<{ table: string; payload: any }> = [];
  let sourceEmailReadCount = 0;

  const db = {
    from(table: string) {
      let insertPayload: any = null;
      const query: any = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        order() { return query; },
        limit() {
          if (table === 'purchases') return Promise.resolve({ data: [], error: null });
          return Promise.resolve({ data: [], error: null });
        },
        insert(payload: any) {
          insertPayload = payload;
          writes.push({ table, payload });
          return query;
        },
        async maybeSingle() {
          if (table === 'email_connections') {
            return {
              data: {
                id: 'connection-1',
                user_id: 'user-1',
                email_address: 'user@buyflow.hu',
              },
              error: null,
            };
          }
          if (table === 'source_emails') {
            sourceEmailReadCount += 1;
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          if (table === 'source_emails' && insertPayload) return { data: { id: 'source-1' }, error: null };
          return { data: null, error: { message: 'unexpected single' } };
        },
      };
      return query;
    },
  };

  const result = await persistNormalizedInboundEmail({
    db,
    email: email(),
    recipientAddress: 'user@buyflow.hu',
  });

  assert.equal(result.status, 'review');
  assert.equal(sourceEmailReadCount, 1);
  assert.deepEqual(writes.map((write) => write.table), ['source_emails']);

  const structured = writes[0]?.payload?.structured_result;
  const shadow = structured?.purchase_identity_shadow_v2;
  assert.equal(shadow?.engine, 'purchase-identity-v2');
  assert.equal(shadow?.mode, 'shadow');
  assert.equal(shadow?.productionWrites, 0);
  assert.equal(shadow?.aiCalls, 0);
  assert.equal(JSON.stringify(shadow).includes('ses-shadow-1'), false);
});
