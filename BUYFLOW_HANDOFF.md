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

## MODULE AUDIT ORDER

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

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

## JOURNEYGRAPH — PASS / migration not applied

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

Prepared migration only:
`supabase/migrations/20260902153000_fix_journeygraph_multishipment_aggregate.sql`

Migration NOT APPLIED. Production DB remediation remains BLOCKED pending controlled staging + multi-shipment smoke.
Protocol: `protocols/JOURNEYGRAPH-AUDIT-2026-09-02.md`.

## DOCVAULT — PASS / migration not applied

Document/content safety audit PASS.

Real issues found and fixed:
- same Purchase + invoice number could silently replace the stored PDF/hash;
- attachment storage path was provider-identity based while using `upsert: true`, so changed bytes after an interrupted retry could overwrite old storage content;
- base `documents.user_id` is required while legacy controlled insert paths did not populate it directly;
- admin-client document reads were Purchase-scoped but did not independently filter `documents.user_id` before signed URL creation.

Current behavior:
- invoice attachment paths include the full PDF SHA-256;
- same attachment identity with changed bytes -> REVIEW before overwrite;
- malformed SHA cannot produce a storage path;
- document owner is forced to equal Purchase owner;
- source ownership is checked when a source is attached;
- any pre-existing cross-user document row makes the migration fail closed for explicit review;
- once a document has a SHA-256, its physical content/storage/provenance identity is immutable;
- an email-body invoice placeholder may be upgraded once to a physical PDF;
- same invoice + different PDF SHA -> hard conflict, never silent replacement;
- new attachment-backed documents explicitly include `user_id` + `source_email_id`;
- document list/detail reads explicitly require `documents.user_id = authenticated user.id`;
- private PDF signed URLs remain 60 seconds and detail responses are `Cache-Control: no-store`.

Verified behavior head: `e77a226f403c6d5141e91d32d277bc99ce91ac21`.
CI #1184 / run `33652929490`: PASS.
Temporary PR #307 closed unmerged.

Prepared migration only:
`supabase/migrations/20260902162000_harden_docvault_content_identity.sql`

Migration NOT APPLIED. Production DB remediation remains BLOCKED pending controlled staging + document storage/ownership smoke.
Protocol: `protocols/DOCVAULT-AUDIT-2026-09-02.md`.

## CORE — PASS / legacy Purchase writes OFF / migration not applied

Purchase authority audit PASS.

Real issues found and remediated:
- old `trg_apply_trusted_merchant_lifecycle_source` trusted the visible `From:` domain and directly changed Purchase state, bypassing TrustLink sender authority and JourneyGraph multi-shipment aggregation;
- old `controlled_create_purchase_with_sources` did not independently prove the current trusted-sender authority contract at the database boundary;
- old order/payment RPCs accepted caller-supplied financial JSON after source validation, so a valid source could act as a bearer token for values not independently re-derived in SQL.

Current source behavior:
- `LEGACY_CORE_PURCHASE_WRITES_ENABLED = false`;
- automatic Purchase creation remains fail-closed even for formerly high-confidence candidates;
- automatic `payment_completed` evidence is fail-closed from the legacy Core lane;
- separately audited Shipment and DocVault controlled write lanes remain available.

Prepared migration only:
`supabase/migrations/20260902170000_harden_core_purchase_authority.sql`

The migration drops the old visible-From lifecycle trigger/function and replaces legacy Purchase create/enrich/payment RPCs with explicit fail-closed functions.

Verified head: `326b6481fc74c9f367a841f334ecd22928030012`.
CI #1185 / run `33658358024`: PASS.
Temporary PR #308 closed unmerged.
Protocol: `protocols/CORE-AUDIT-2026-09-02.md`.

Migration NOT APPLIED. Production Core DB remediation remains BLOCKED pending controlled staging migration + existing Purchase/state smoke.

## DEPLOYMENT STATE

Still conservative:
- direct Gmail runtime OFF;
- source archive OFF;
- Mailgun source persistence OFF;
- EventMind V11 runtime OFF;
- TrustLink production writes OFF;
- legacy automatic Purchase creation/payment Core writes OFF;
- JourneyGraph migration NOT APPLIED;
- DocVault migration NOT APPLIED;
- Core migration NOT APPLIED;
- no live migration applied from this flow;
- no provider cutover;
- no AI identity authority;
- no Purchase/Shipment/Document/Identity production authority change.

## NEXT ACTION

1. Continue the module audit with **Pulse**.
2. Keep PR #295 draft and all live/source/AI/write flags OFF.
3. Preserve the EventMind first gate result unchanged and never train on that fixture.
4. MailGate/RawVault production smokes are still required before source cutover.
5. Trusted provider-authentication provenance must be implemented and separately verified before merchant-scoped TrustLink promotion can be enabled.
6. JourneyGraph migration must first pass controlled staging + multi-shipment smoke.
7. DocVault migration must first pass controlled staging + PDF ownership/content smoke.
8. Core migration must first pass controlled staging + existing Purchase/state smoke.
9. Do not promote V12.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
