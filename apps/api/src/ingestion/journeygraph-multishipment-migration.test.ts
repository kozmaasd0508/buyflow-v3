import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../../supabase/migrations/20260902153000_fix_journeygraph_multishipment_aggregate.sql',
  import.meta.url,
);
const migration = readFileSync(migrationUrl, 'utf8');

test('JourneyGraph migration completes a Purchase only when every Shipment is delivered', () => {
  assert.match(migration, /v_delivered_count = v_shipment_count/);
  assert.match(migration, /when v_in_transit_count > 0 then 'in_transit'/);
  assert.match(migration, /when v_ready_for_pickup_count > 0 then 'ready_for_pickup'/);
  assert.doesNotMatch(migration, /when p_status = 'delivered' then 'delivered'/);
});

test('JourneyGraph migration uses the final parcel delivery time for whole-Purchase completion', () => {
  assert.match(migration, /max\(delivered_at\) filter \(where status = 'delivered'\)/);
  assert.match(migration, /when v_aggregate_state <> 'delivered' then null/);
  assert.match(migration, /when v_delivered_timestamp_count <> v_shipment_count then null/);
});

test('JourneyGraph controlled shipment function keeps its privileged surface locked down', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.controlled_upsert_shipment_with_sources[\s\S]*from public;/);
  assert.match(migration, /from anon;/);
  assert.match(migration, /from authenticated;/);
  assert.match(migration, /grant execute on function public\.controlled_upsert_shipment_with_sources[\s\S]*to service_role;/);
});
