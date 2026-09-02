# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with current GitHub/live state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Source/audit branch:** `codex/modern-email-source-foundation-v1`  
**Architecture PR:** #295 draft -> `codex/v9-real-gmail-identity-shadow`

## SAFETY CONTRACT

- Qwen/AI classifies commerce/lifecycle semantics only; it never grants hard Purchase identity.
- Purchase Identity Graph v2 remains the only identity/link/create/merge authority.
- Lifecycle-only email cannot create a Purchase.
- Multiple/hard-conflicting identity candidates remain REVIEW/PENDING.
- Direct Gmail runtime, source archive, Mailgun persistence, EventMind production runtime and TrustLink production writes remain OFF.
- Legacy automatic Purchase creation/payment Core writes remain OFF/fail-closed.
- No provider production cutover or live migration was performed from this audit.
- Raw/private email fixtures and local model results stay out of Git.
- V11 remains the reference semantic model. V12 is not promoted.

## MODULE AUDIT ORDER — COMPLETE

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

All nine code-audit modules have now been reviewed. This does **not** mean production cutover is approved; the staging/source/authentication gates listed below remain mandatory.

## MAILGATE — PASS / production blocked

Code remediation PASS. Safe initial snapshot/cursor behavior, detached body hydration, timestamp fail-closed behavior, bounded retry/concurrency, expired-history recovery, watch renewal/fallback sync and strict OAuth authority are implemented.

Behavior head: `e67b908e07d072e3737611eca4ee804d7d905c26`.

Production remains BLOCKED pending controlled real-Gmail read-only shadow smoke.

## RAWVAULT — PASS / production blocked

Immutable raw/normalized archive, SHA-256/opaque keys, durable pre-write manifest, explicit retention, crash/orphan/account-deletion cleanup, raw-hash conflict detection and DB immutability are implemented.

Behavior head: `9480e6d4e8d5c3e0a771b43671503cda593971c2`.

Production remains BLOCKED pending controlled staging migration + retention/private-storage cleanup smoke.

## MAILLENS — PASS

`normalized-email-document-v1.1` is the single provider-neutral semantic normalization boundary. Current `semanticText` is separated from full bounded `bodyText`; quoted history/hidden content are controlled; attachments cannot inject authored body; header authentication is diagnostic-only.

Behavior head: `f69195404831323f2783464a61f6f7b7435698b5`.
CI #1151 / run `33631564933`: PASS.

## EVENTMIND — PASS / production OFF

Identity/input boundary PASS. `apps/api/src/ai/eventmind-v1.ts` accepts MailLens semantic input only, fixed 18-event taxonomy, and exactly `is_commerce` + `event_type`; identity-bearing model output invalidates the response.

V11 runtime safety PASS/OFF. Exact adapter SHA required, Qwen3-8B model metadata pinned, thinking explicitly OFF, deterministic generation, runtime/template metadata checked, failures fail closed.

Fresh untouched local GPU gate:
- 90/90 exact = **100%**
- macro event = **100%**
- invalid = **0**
- unsafe promotions = **0**
- fixture SHA: `4d70c774b332edbc7aabe19d754f51ac2e47762c3d17cc018f25d4786d91fd0e`
- V11 adapter SHA: `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`

Never train on that fixture.
CI #1167 / run `33635810471`: PASS.
Protocol: `protocols/EVENTMIND-AUDIT-2026-09-02.md`.

Production EventMind remains OFF/BLOCKED; the synthetic gate is not full real-mailbox generalization proof.

## TRUSTLINK — PASS / production writes OFF

Zero-trust correlation audit PASS. User+namespace-scoped hard keys, ambiguity -> REVIEW, hard conflict -> PENDING, lifecycle-only no Purchase creation, shadow graph writes only.

Real sender-authority gap was fixed: merchant-scoped creation/link promotion now requires explicit trusted provider-adapter authority (`field=sender_authority`, `source=provider_adapter`, qualifier `trusted_sender_authority`). Raw/header auth cannot satisfy the gate.

Verified head: `dcbd2e5a95b00d1b7c67ce845329d9b8164cc8ba`.
CI #1169 / run `33648405215`: PASS.
Protocol: `protocols/TRUSTLINK-AUDIT-2026-09-02.md`.

Real trusted provider-authentication provenance is still not wired, so merchant-scoped production promotion remains BLOCKED.

## JOURNEYGRAPH — PASS / DB smoke PASS / production migration not applied

State audit PASS.

Fixed:
- one delivered parcel no longer completes a multi-parcel Purchase;
- Purchase becomes `delivered` only when every linked Shipment is delivered;
- whole-Purchase `delivered_at` is the final/latest parcel delivery time;
- outstanding transit/pickup progress is preserved;
- stale order/payment/delay evidence cannot override proven physical Shipment progress;
- `ready_for_pickup` is protected from stale downgrade;
- controlled Shipment replay/verification is monotonic and aggregate-aware;
- cancelled/refunded/returned remain protected terminal states.

Verified behavior head: `8ef8d36bb9f0ee7ebce3477c13e30f510df30e4f`.
CI #1183 / run `33651035053`: PASS.
Temporary PR #306 closed unmerged.

Prepared migration:
`supabase/migrations/20260902153000_fix_journeygraph_multishipment_aggregate.sql`

Controlled isolated Supabase smoke on 2026-09-02: **PASS**. Two-parcel aggregation and ready-for-pickup monotonic behavior passed. Production migration remains NOT APPLIED.
Protocol: `protocols/JOURNEYGRAPH-AUDIT-2026-09-02.md` and `protocols/STAGING-SMOKE-2026-09-02.md`.

## DOCVAULT — PASS / DB smoke PASS / production migration not applied

Document/content safety audit PASS.

Real issues found and fixed:
- same Purchase + invoice number could silently replace the stored PDF/hash;
- attachment storage path was provider-identity based while using `upsert: true`, so changed bytes after an interrupted retry could overwrite the old object;
- live `documents` schema predates direct `user_id` / `source_email_id`, so a bridge migration is required before hardening;
- admin-client document reads were Purchase-scoped but did not independently filter `documents.user_id` before signed URL creation.

Current behavior:
- invoice attachment paths include the full PDF SHA-256;
- same attachment identity with changed bytes -> REVIEW before overwrite;
- malformed SHA cannot produce a storage path;
- document owner is forced to equal Purchase owner;
- source ownership is checked when a source is attached;
- once a document has a SHA-256, physical content/storage/provenance identity is immutable;
- same invoice + different PDF SHA -> hard conflict, never silent replacement;
- document list/detail reads require `documents.user_id = authenticated user.id`;
- private PDF signed URLs remain 60 seconds and detail responses remain `Cache-Control: no-store`.

Verified behavior head: `e77a226f403c6d5141e91d32d277bc99ce91ac21`.
CI #1184 / run `33652929490`: PASS.
Temporary PR #307 closed unmerged.

Prepared migrations:
`supabase/migrations/20260902161000_prepare_docvault_owner_columns.sql`
`supabase/migrations/20260902162000_harden_docvault_content_identity.sql`

Controlled isolated Supabase smoke on 2026-09-02: **PASS**. Legacy owner backfill, same-PDF idempotency, different-PDF hash conflict, cross-user ownership blocking and hashed storage immutability all passed. Production migrations remain NOT APPLIED.
Protocol: `protocols/DOCVAULT-AUDIT-2026-09-02.md` and `protocols/STAGING-SMOKE-2026-09-02.md`.

## CORE — PASS / DB smoke PASS / legacy Purchase writes OFF / production migration not applied

Purchase authority audit PASS.

Real issues found and remediated:
- old `trg_apply_trusted_merchant_lifecycle_source` trusted the visible `From:` domain and directly changed Purchase state, bypassing TrustLink sender authority and JourneyGraph multi-shipment aggregation;
- old `controlled_create_purchase_with_sources` did not independently prove the current trusted-sender authority contract at the database boundary;
- old order/payment RPCs accepted caller-supplied financial JSON after source validation.

Current source behavior:
- `LEGACY_CORE_PURCHASE_WRITES_ENABLED = false`;
- automatic Purchase creation remains fail-closed;
- automatic payment evidence is fail-closed from the legacy Core lane;
- separately audited Shipment and DocVault controlled write lanes remain available.

Prepared migration:
`supabase/migrations/20260902170000_harden_core_purchase_authority.sql`

Verified head: `326b6481fc74c9f367a841f334ecd22928030012`.
CI #1185 / run `33658358024`: PASS.
Temporary PR #308 closed unmerged.

Controlled isolated Supabase smoke on 2026-09-02: **PASS**. Legacy lifecycle trigger removed, create/enrich/payment RPCs fail closed, Shipment/DocVault lanes preserved, and tested RPC EXECUTE is service-role-only. Production migration remains NOT APPLIED.
Protocol: `protocols/CORE-AUDIT-2026-09-02.md` and `protocols/STAGING-SMOKE-2026-09-02.md`.

## PULSE — PASS / read-only projection

User-facing status/next-step authority audit PASS.

Current behavior:
- server-side `apps/api/src/api/purchase-pulse.ts` is the single user-facing status projection;
- REVIEW/PENDING wins over optimistic timestamps or child hints;
- one delivered parcel cannot complete a multi-parcel Purchase;
- `deliveredAt` alone cannot promote delivery;
- `paidAt` alone cannot promote an ordered Purchase;
- `ready_for_pickup` and `out_for_delivery` are explicit states;
- movement counts only physical Shipment progress;
- unknown states fail closed;
- Purchase cards, home counters, detail overview and timeline all consume the same Pulse projection;
- no live push notification engine was added or enabled.

Verified head: `df75e04989afd89df080942adcf31cb4ee4ec2d4`.
Final CI #1187 / run `33660311868`: PASS.
Temporary PR #309 closed unmerged.
Protocol: `protocols/PULSE-AUDIT-2026-09-02.md`.

## CONTROLLED DATABASE SMOKE — PASS

Protocol: `protocols/STAGING-SMOKE-2026-09-02.md`.

Because the old `BuyFlow-Staging` project is on an incompatible/stale schema lineage, it was not mutated. A separate zero-cost `BuyFlow-Smoke-Test` project was built from the production-equivalent required schema and synthetic data only.

Results:
- JourneyGraph migration: PASS;
- DocVault schema bridge: PASS;
- DocVault hardening: PASS;
- Core hardening: PASS;
- service-role-only RPC privilege checks: PASS;
- read-only production preflight: 9 documents, 0 orphan documents, 0 existing conflicting invoice-hash groups, 1 multi-shipment Purchase, 0 inconsistent multi-shipment aggregate states.

Cleanup:
- `BuyFlow-Smoke-Test`: INACTIVE;
- original `BuyFlow-Staging`: restored to ACTIVE_HEALTHY;
- production `buyflow-v3`: not modified.

Supabase production security advisor currently has only pre-existing INFO notices for private/backend RLS tables without client policies plus a WARN that leaked-password protection is disabled. No hardening-specific advisor error was observed.

## DEPLOYMENT STATE

Still conservative:
- direct Gmail runtime OFF;
- source archive OFF;
- Mailgun source persistence OFF;
- EventMind V11 runtime OFF;
- TrustLink production writes OFF;
- legacy automatic Purchase creation/payment Core writes OFF;
- JourneyGraph production migration NOT APPLIED;
- DocVault production migrations NOT APPLIED;
- Core production migration NOT APPLIED;
- no live push notification engine enabled;
- no provider cutover;
- no AI identity authority;
- no production Purchase/Shipment/Document/Identity authority change.

## NEXT ACTION — REMAINING PRE-PRODUCTION GATES

1. Keep PR #295 draft and all live/source/AI/write flags OFF.
2. Run MailGate real-Gmail **read-only shadow smoke** before any source cutover.
3. Run RawVault controlled retention/private-storage/orphan/account-deletion cleanup smoke.
4. Implement and separately verify real trusted provider-authentication provenance before merchant-scoped TrustLink promotion can be enabled.
5. Keep the database migration set production-unapplied until those upstream gates are complete and a separate production-cutover decision is made.
6. Consider enabling Supabase Auth leaked-password protection separately; it is an existing advisor warning, not introduced by this audit.
7. Do not promote V12.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból. A 9 modulos kódaudit és a JourneyGraph/DocVault/Core izolált DB smoke PASS. Következő: MailGate real-Gmail read-only shadow smoke, majd RawVault storage/retention smoke és trusted provider-auth provenance. Production továbbra is OFF.**
