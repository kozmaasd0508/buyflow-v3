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

function emptyDb() {
  return {
    from(table: string) {
      assert.ok(table === 'purchases' || table === 'source_emails');
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) {
          if (column === 'user_id') assert.equal(value, 'user-1');
          if (column === 'processing_status') assert.equal(value, 'unlinked');
          return query;
        },
        order() { return query; },
        limit() { return Promise.resolve({ data: [], error: null }); },
      };
      return query;
    },
  };
}

test('returns privacy-safe zero-write diagnostic with durable unresolved telemetry', async () => {
  const result = await runShoppingEmailIdentityShadow({ db: emptyDb(), userId: 'user-1', email: email() });
  assert.equal(result.status, 'completed');
  assert.equal(result.productionWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(result.snapshotCounts?.purchases, 0);
  assert.equal(result.simulatedGraphMutated, false);
  assert.deepEqual(result.durableUnresolved, {
    sourceRowsRead: 0,
    eventsAccepted: 0,
    eventsRejected: 0,
  });
  assert.equal(result.deferredResolution?.initialUnresolvedCount, 0);
  assert.equal(result.deferredResolution?.recoveredEventCount, 0);
  assert.equal(result.evidencePacketSummary?.schemaVersion, 1);
  assert.equal(JSON.stringify(result).includes('shadow-msg-1'), false);
  assert.equal(JSON.stringify(result).includes('hello@example.com'), false);
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
  assert.equal(result.durableUnresolved, null);
  assert.equal(result.deferredResolution, null);
  assert.equal(result.evidencePacketSummary, null);
  assert.deepEqual(result.limitations, ['shadow_runtime_error']);
});
