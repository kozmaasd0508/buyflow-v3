# Controlled database smoke — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`

## Safety boundary

No production migration or production write was performed.

The existing `BuyFlow-Staging` project was found to be on an older, incompatible schema lineage, so it was not mutated. It was temporarily paused only to free the Free-plan project slot, then restored to `ACTIVE_HEALTHY` after the test.

A separate zero-cost `BuyFlow-Smoke-Test` Supabase project was created in `eu-west-1`, tested with synthetic data only, then paused to `INACTIVE`. The connector available in this session does not expose project deletion, so the test project was not falsely reported as deleted.

Production project `buyflow-v3` (`acjenqkrvnkdvvgordry`) was used read-only for schema/data preflight only.

## Production-equivalent smoke baseline

The smoke project was built from the production columns required by JourneyGraph / DocVault / Core rather than from the stale staging schema. It reproduced the legacy lifecycle trigger so Core could prove that the bypass is actually removed.

A legacy document row without direct `documents.user_id` / `source_email_id` was inserted before the DocVault bridge migration to exercise real backfill behavior.

## Migrations exercised

In order:

1. `20260902153000_fix_journeygraph_multishipment_aggregate.sql`
2. `20260902161000_prepare_docvault_owner_columns.sql`
3. `20260902162000_harden_docvault_content_identity.sql`
4. `20260902170000_harden_core_purchase_authority.sql`

All four applied successfully in the isolated smoke project.

## JourneyGraph smoke — PASS

Synthetic two-parcel Purchase:
- both parcels initially `in_transit`;
- first parcel changed to `delivered` -> whole Purchase remained `in_transit`, `delivered_at` remained null;
- second parcel changed to `delivered` -> whole Purchase became `delivered`;
- whole-Purchase `delivered_at` became the later/final parcel delivery timestamp (`2026-09-02T13:00:00Z`).

Monotonic pickup test:
- Shipment moved to `ready_for_pickup`;
- later weaker `in_transit` replay did not downgrade it;
- whole Purchase remained `ready_for_pickup`.

Verdict: **PASS**.

## DocVault smoke — PASS

Legacy bridge:
- legacy document owner was derived only through the owning Purchase;
- backfill completed and `documents.user_id` became non-null.

Content identity:
- first controlled invoice PDF stored with expected owner and SHA-256;
- identical retry returned the same Document and did not duplicate it;
- same Purchase + invoice number with a different PDF SHA-256 was rejected (`document content hash conflict`);
- cross-user document ownership was rejected;
- storage path mutation after a content hash exists was rejected (`hashed document content identity is immutable`).

Verdict: **PASS**.

## Core smoke — PASS

Confirmed after migration:
- legacy `trg_apply_trusted_merchant_lifecycle_source` no longer exists;
- `controlled_create_purchase_with_sources` fails closed;
- `controlled_enrich_purchase_from_order_source` fails closed;
- `controlled_apply_payment_evidence` fails closed;
- controlled Shipment RPC remains present;
- controlled DocVault RPC remains present.

RPC privileges:
- `anon`: EXECUTE false;
- `authenticated`: EXECUTE false;
- `service_role`: EXECUTE true;
for Shipment, DocVault and tested Core RPCs.

Verdict: **PASS**.

## Read-only production preflight

No production rows were changed.

Observed before any future migration:
- documents: `9`;
- orphan documents (missing Purchase): `0`;
- existing same-Purchase/same-invoice groups with conflicting non-null PDF hashes: `0`;
- multi-shipment Purchases: `1`;
- false whole-Purchase delivered while some linked parcel is not delivered: `0`;
- all parcels delivered while whole Purchase is not delivered: `0`.

This means the current production data set does not show the legacy inconsistencies targeted by the three database hardenings.

## Supabase security advisor

The isolated smoke baseline intentionally omitted the production RLS policy set, so its `RLS Disabled in Public` findings are test-baseline artifacts, not findings introduced by these migrations.

The real production project was checked read-only. Current advisor findings are pre-existing and separate from this smoke:
- INFO: backend/private tables with RLS enabled and no client policies (`email_attachments`, `email_oauth_states`, `email_scan_jobs`, `webhook_inbox`);
- WARN: leaked-password protection is disabled in Supabase Auth.

No hardening-specific production security advisor error was observed.

## Cleanup

- `BuyFlow-Smoke-Test`: `INACTIVE` after testing;
- original `BuyFlow-Staging`: restored to `ACTIVE_HEALTHY`;
- production `buyflow-v3`: not modified.

## Verdict

**JourneyGraph DB smoke: PASS**  
**DocVault DB smoke: PASS**  
**Core DB smoke: PASS**  
**Production preflight for these migrations: PASS**

This is not production cutover approval. Production migrations remain unapplied. Remaining gates include MailGate real-Gmail read-only shadow smoke, RawVault retention/private-storage smoke, and trusted provider-authentication provenance for TrustLink before any production write/source enablement.
