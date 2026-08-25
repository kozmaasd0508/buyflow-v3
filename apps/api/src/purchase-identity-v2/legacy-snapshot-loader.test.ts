import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLegacyPurchaseIdentitySnapshot } from './legacy-snapshot-loader.js';

function mockDb() {
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const inCalls: Array<{ table: string; column: string; values: unknown[] }> = [];
  const writes: string[] = [];

  const rows: Record<string, any[]> = {
    purchases: [{ id: 'p-1', user_id: 'user-1', order_number: 'ORDER-1', current_state: 'shipped' }],
    shipments: [{ id: 's-1', user_id: 'user-1', purchase_id: 'p-1', carrier_slug: 'gls', tracking_number: 'TRACK-1', status: 'in_transit' }],
    documents: [{ id: 'd-1', user_id: 'user-1', purchase_id: 'p-1', type: 'invoice', document_number: 'INV-1' }],
  };

  return {
    eqCalls,
    inCalls,
    writes,
    db: {
      from(table: string) {
        const query: any = {
          select() { return query; },
          eq(column: string, value: unknown) {
            eqCalls.push({ table, column, value });
            return query;
          },
          in(column: string, values: unknown[]) {
            inCalls.push({ table, column, values });
            return query;
          },
          order() { return query; },
          limit() { return Promise.resolve({ data: rows[table] ?? [], error: null }); },
          insert() { writes.push(`${table}:insert`); return query; },
          update() { writes.push(`${table}:update`); return query; },
          delete() { writes.push(`${table}:delete`); return query; },
        };
        return query;
      },
    },
  };
}

test('loads only user-scoped legacy data and performs no writes', async () => {
  const mock = mockDb();
  const result = await loadLegacyPurchaseIdentitySnapshot({ db: mock.db, userId: 'user-1' });

  assert.equal(result.snapshot.purchases.length, 1);
  assert.equal(result.snapshot.orders[0]?.orderId, 'ORDER-1');
  assert.equal(result.snapshot.orders[0]?.merchantId, null);
  assert.equal(result.snapshot.shipments[0]?.carrierId, 'gls');
  assert.equal(result.snapshot.shipments[0]?.trackingId, 'TRACK-1');
  assert.equal(result.snapshot.invoices[0]?.issuerId, null);
  assert.equal(result.snapshot.payments.length, 0);
  assert.deepEqual(mock.writes, []);

  const userScopes = mock.eqCalls.filter((call) => call.column === 'user_id');
  assert.deepEqual(userScopes.map((call) => [call.table, call.value]), [
    ['purchases', 'user-1'],
    ['shipments', 'user-1'],
    ['documents', 'user-1'],
  ]);
});

test('never upgrades legacy merchant/order data into hard merchant identity', async () => {
  const mock = mockDb();
  const result = await loadLegacyPurchaseIdentitySnapshot({ db: mock.db, userId: 'user-1' });

  assert.equal(result.snapshot.purchases[0]?.canonicalMerchantId, null);
  assert.equal(result.snapshot.orders[0]?.merchantId, null);
});
