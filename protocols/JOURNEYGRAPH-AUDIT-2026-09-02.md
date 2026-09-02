# JourneyGraph audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`

## Role

JourneyGraph turns already-safely-linked Purchase / Shipment lifecycle evidence into a conservative current journey state.

It must not:
- complete an entire Purchase because only one parcel completed;
- let stale order/payment/delay mail overwrite newer physical parcel progress;
- merge different Shipment identities;
- invent delivery timestamps;
- bypass TrustLink identity decisions.

## Existing safety reviewed

- Purchase Identity Graph v2 supports multiple Shipments under one Purchase;
- REVIEW/PENDING identity decisions do not mutate the graph;
- Shipment identity remains user + carrier namespace + tracking-id scoped;
- terminal cancelled/refunded/returned states are protected from controlled shipment writes;
- carrier-parcel-sender bridging uses the same controlled shipment RPC instead of a separate Purchase-state write path;
- Foxpost repair only repairs source-email evidence and does not directly update Purchase journey state.

## Findings and remediation

### 1. Multi-shipment Purchase could complete too early

The previous controlled shipment RPC set the whole Purchase to `delivered` as soon as one linked Shipment became delivered. For split or multi-parcel orders this could falsely complete the order while another parcel was still in transit or waiting for pickup.

Remediation:
- all linked Shipments are reduced together;
- whole Purchase becomes `delivered` only when every Shipment is delivered;
- if any parcel is still physically in transit, whole Purchase remains `in_transit`;
- otherwise a remaining pickup parcel keeps the Purchase at `ready_for_pickup`;
- unknown legacy outstanding Shipment state cannot preserve a false delivered state.

### 2. Whole-Purchase delivery timestamp was wrong for multiple parcels

The old path could keep the first parcel delivery time as the Purchase delivery time.

Remediation:
- whole-Purchase `delivered_at` exists only when every Shipment is delivered;
- it uses the latest parcel delivery timestamp, i.e. the final parcel completion time;
- missing delivered timestamps fail closed to `null` instead of inventing a time.

### 3. Ready-for-pickup could be downgraded by stale lifecycle mail

`ready_for_pickup` was not protected everywhere as physical progress.

Remediation:
- `ready_for_pickup` is now a protected physical-progress state;
- stale order packing / processing / delay evidence cannot move it backwards.

### 4. Physical Shipment progress could leave a stale payment/delay state visible

A Purchase that previously showed `payment_failed` or `delayed` could remain there even after controlled, proven physical Shipment progress existed.

Remediation:
- proven aggregate physical progress becomes the current journey state for all non-terminal Purchases;
- payment status remains separate data and is not erased;
- cancelled/refunded/returned remain protected terminal states.

### 5. Controlled post-write verification used the old single-parcel assumption

The controlled shipment script could reject a correct multi-shipment database result after the database write, and an older replay could be falsely treated as a status mismatch.

Remediation:
- post-write verification now recomputes the aggregate from all linked Shipments;
- individual Shipment verification is monotonic (`delivered` and `ready_for_pickup` cannot be downgraded by older evidence);
- `shipment_created` / pre-advice is explicitly rejected from the physical controlled-write lane.

## Database migration

Prepared only:

`supabase/migrations/20260902153000_fix_journeygraph_multishipment_aggregate.sql`

The migration preserves the privileged RPC boundary:
- `SECURITY DEFINER`;
- `search_path = ''`;
- schema-qualified objects;
- PUBLIC / anon / authenticated execute revoked;
- execute granted only to `service_role`.

The migration was **not applied** to staging or production in this audit.

## Verification

Exact verified behavior head:
`8ef8d36bb9f0ee7ebce3477c13e30f510df30e4f`

GitHub Actions:
- CI #1183
- run `33651035053`
- API typecheck: PASS
- API tests: PASS
- API build: PASS
- mobile typecheck: PASS
- mobile web build: PASS
- EventMind runtime / launcher syntax checks: PASS

Temporary verification PR #306 was closed unmerged.

## Verdict

- JourneyGraph code / state semantics: **PASS**.
- Multi-shipment safety regressions: **PASS**.
- Production database migration: **NOT APPLIED / BLOCKED** pending controlled staging migration and multi-shipment smoke.
- No production/source/AI flag was enabled.

Next module audit: **DocVault**.
