import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260902170000_harden_core_purchase_authority.sql', import.meta.url),
  'utf8',
);

test('Core migration removes the legacy From-domain lifecycle trigger', () => {
  assert.match(migration, /drop trigger if exists trg_apply_trusted_merchant_lifecycle_source/i);
  assert.match(migration, /drop function if exists public\.apply_trusted_merchant_lifecycle_source\(\)/i);
});

test('Core migration fail-closes legacy Purchase creation and enrichment RPCs', () => {
  assert.match(migration, /controlled_create_purchase_with_sources[\s\S]*legacy automatic Purchase creation is disabled/i);
  assert.match(migration, /controlled_enrich_purchase_from_order_source[\s\S]*legacy automatic Purchase financial\/product enrichment is disabled/i);
  assert.match(migration, /controlled_apply_payment_evidence[\s\S]*legacy automatic Purchase payment mutation is disabled/i);
});

test('Core authority migration does not contain direct Purchase mutation SQL', () => {
  assert.doesNotMatch(migration, /update\s+public\.purchases/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.purchases/i);
});
