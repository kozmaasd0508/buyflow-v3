import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { runShoppingEmailIdentityShadow } from './shopping-email-shadow-runtime.js';

function email(): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'shadow-msg-1',
    subject: 'Weekly news',
    from: [{ email: 'hello@example.com', name: 'Example' }],
    to: [{ email: 'user@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-23T19:00:00.000Z',
    snippet: 'Read our latest stories.',
    folders: ['inbound'],
    attachments: [],
  };
}

test('returns compact zero-write diagnostic on an empty user snapshot', async () => {
  const db = {
    from(table: string) {
      assert.equal(table, 'purchases');
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) {
          assert.equal(column, 'user_id');
          assert.equal(value, 'user-1');
          return query;
        },
        order() { return query; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      return query;
    },
  };

  const result = await runShoppingEmailIdentityShadow({ db, userId: 'user-1', email: email() });
  assert.equal(result.status, 'completed');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.snapshotCounts?.purchases, 0);
  assert.equal(result.simulatedGraphMutated, false);
  assert.equal(JSON.stringify(result).includes('shadow-msg-1'), false);
});

test('shadow runtime failure is contained and never throws into inbound ingestion', async () => {
  const db = {
    from() {
      throw new Error('database unavailable');
    },
  };

  const result = await runShoppingEmailIdentityShadow({ db, userId: 'user-1', email: email() });
  assert.equal(result.status, 'error');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.deepEqual(result.limitations, ['shadow_runtime_error']);
});
