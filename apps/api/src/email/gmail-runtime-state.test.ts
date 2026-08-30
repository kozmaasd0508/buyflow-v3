import assert from 'node:assert/strict';
import test from 'node:test';
import { commitGmailSyncCursor } from './gmail-runtime-state.js';

test('Gmail cursor commit delegates to compare-and-swap RPC with expected cursor', async () => {
  let rpcName = '';
  let rpcArgs: Record<string, unknown> = {};
  const db = {
    from() { throw new Error('from() should not be used by cursor commit'); },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcName = name;
      rpcArgs = args;
      return { data: true, error: null };
    },
  };

  const committed = await commitGmailSyncCursor({
    db,
    userId: 'user-1',
    emailConnectionId: 'connection-1',
    expectedCursor: {
      provider: 'gmail',
      value: '100',
      observedAt: '2026-08-30T20:00:00.000Z',
    },
    nextCursor: {
      provider: 'gmail',
      value: '105',
      observedAt: '2026-08-30T20:01:00.000Z',
    },
  });

  assert.equal(committed, true);
  assert.equal(rpcName, 'commit_email_sync_cursor');
  assert.equal(rpcArgs.p_expected_cursor, '100');
  assert.equal(rpcArgs.p_next_cursor, '105');
  assert.equal(rpcArgs.p_email_connection_id, 'connection-1');
});

test('stale Gmail cursor compare-and-swap is reported without overwriting state', async () => {
  const db = {
    from() { throw new Error('from() should not be used by cursor commit'); },
    async rpc() { return { data: false, error: null }; },
  };

  const committed = await commitGmailSyncCursor({
    db,
    userId: 'user-1',
    emailConnectionId: 'connection-1',
    expectedCursor: null,
    nextCursor: {
      provider: 'gmail',
      value: '200',
      observedAt: '2026-08-30T20:02:00.000Z',
    },
  });

  assert.equal(committed, false);
});
