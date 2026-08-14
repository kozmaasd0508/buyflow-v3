import assert from 'node:assert/strict';
import test from 'node:test';
import { applyUserProductOverrides, type UserProductOverrideRun } from './product-user-overrides.js';

const purchaseId = '11111111-1111-4111-8111-111111111111';

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    purchase_id: purchaseId,
    source_key: 'sku:test-1',
    name: 'AI name',
    brand: 'AI brand',
    quantity: 1,
    unit_price: 1000,
    ...overrides,
  };
}

function run(result: Record<string, unknown>): UserProductOverrideRun {
  return {
    purchase_id: purchaseId,
    result,
  };
}

test('hides a product by product id', () => {
  const visible = applyUserProductOverrides([
    product(),
  ], [
    run({ action: 'hide_product', product_id: '22222222-2222-4222-8222-222222222222' }),
  ]);

  assert.equal(visible.length, 0);
});

test('hide survives a regenerated product id when source key is stable', () => {
  const visible = applyUserProductOverrides([
    product({ id: '33333333-3333-4333-8333-333333333333' }),
  ], [
    run({
      action: 'hide_product',
      product_id: '22222222-2222-4222-8222-222222222222',
      source_key: 'sku:test-1',
    }),
  ]);

  assert.equal(visible.length, 0);
});

test('applies manual edits after AI values and keeps the latest edit', () => {
  const [visible] = applyUserProductOverrides([
    product(),
  ], [
    run({
      action: 'edit_product',
      product_id: '22222222-2222-4222-8222-222222222222',
      source_key: 'sku:test-1',
      changes: { name: 'Kézzel javított név', brand: null, unit_price: 1200 },
    }),
    run({
      action: 'edit_product',
      product_id: '22222222-2222-4222-8222-222222222222',
      source_key: 'sku:test-1',
      changes: { unit_price: 1350 },
    }),
  ]);

  assert.ok(visible);
  assert.equal(visible.name, 'Kézzel javított név');
  assert.equal(visible.brand, null);
  assert.equal(visible.unit_price, 1350);
  assert.equal(visible.quantity, 1);
});

test('ignores malformed and unsupported change fields', () => {
  const [visible] = applyUserProductOverrides([
    product(),
  ], [
    run({
      action: 'edit_product',
      product_id: '22222222-2222-4222-8222-222222222222',
      changes: { purchase_id: 'attacker-value', hidden: true, quantity: Number.NaN },
    }),
  ]);

  assert.ok(visible);
  assert.equal(visible.purchase_id, purchaseId);
  assert.equal(visible.quantity, 1);
  assert.equal('hidden' in visible, false);
});
