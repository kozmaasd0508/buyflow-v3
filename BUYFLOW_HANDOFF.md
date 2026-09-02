# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then the newest worklog/protocol entries. Reconcile with live GitHub/Supabase state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Source/audit branch:** `codex/modern-email-source-foundation-v1`  
**Architecture PR:** #295 draft -> `codex/v9-real-gmail-identity-shadow`

## SAFETY CONTRACT

- Qwen/AI classifies commerce/lifecycle semantics only; it never grants Purchase identity.
- Purchase Identity Graph v2 is the only identity/link/create/merge authority.
- Lifecycle-only email cannot create a Purchase.
- Multiple/hard-conflicting identity candidates remain REVIEW/PENDING.
- Direct Gmail runtime, source archive, EventMind production runtime and TrustLink production writes remain OFF.
- Legacy automatic Purchase creation/payment Core writes remain OFF/fail-closed.
- No production provider cutover or production migration was performed by this audit/smoke flow.
- V11 remains the semantic reference model; V12 is not promoted.

## 9-MODULE CODE AUDIT — COMPLETE

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

### MailGate — code PASS / live read PASS / cursor-history BLOCKED
- Code remediation head: `e67b908e07d072e3737611eca4ee804d7d905c26`; CI #1142 PASS.
- 2026-09-02 real Gmail read-only smoke: six bounded recent commerce/lifecycle messages, exact RAW MIME **6/6**, observed normal body parity PASS, Gmail mutation safety PASS.
- A sampled UNREAD message remained UNREAD after RAW inspection.
- Since smoke start: **0 source emails, 0 Purchase updates, 0 Shipment updates, 0 Documents, 0 AI runs** in production.
- No detached renderable text body happened to occur in the six-message live slice; detached-body hydration remains regression-covered, not claimed as live evidence.
- **Real `historyId` capture + `history.list` replay are still BLOCKED / NOT RUN.** The connected Gmail tool has no history endpoint, and production does not yet have `email_provider_credentials` / `email_sync_states` or a direct Gmail runtime connection.
- Direct Gmail production runtime remains OFF.
- Protocol: `protocols/MAILGATE-REAL-GMAIL-SHADOW-SMOKE-2026-09-02.md` and `protocols/MAILGATE-DIRECT-GMAIL-AUDIT-REMEDIATION-2026-09-02.md`.

### RawVault — code PASS / storage-retention smoke still required
- Immutable raw/normalized archive, SHA-256/opaque keys, durable manifest, retention/crash/orphan/account-deletion cleanup and DB immutability implemented.
- Behavior head: `9480e6d4e8d5c3e0a771b43671503cda593971c2`.
- Production source archive remains OFF.
- Remaining: controlled private-storage + retention/orphan/account-deletion cleanup smoke.

### MailLens — PASS
- `normalized-email-document-v1.1` is the provider-neutral normalization boundary.
- Full bounded `bodyText` and current-only `semanticText` are separate; quoted/hidden content controlled; attachments cannot inject authored body; header auth diagnostic-only.
- Head `f69195404831323f2783464a61f6f7b7435698b5`; CI #1151 PASS.

### EventMind — PASS / production OFF
- Fixed 18-event taxonomy; strict output exactly `is_commerce` + `event_type`; identity-bearing output invalidates response.
- V11 runtime fail-closed, deterministic, thinking OFF, exact adapter/runtime metadata pinned.
- First untouched 90-case local GPU gate: **90/90 exact, 100% macro, invalid 0, unsafe 0**.
- Fixture SHA `4d70c774b332edbc7aabe19d754f51ac2e47762c3d17cc018f25d4786d91fd0e`; adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`.
- Never train on that fixture. Production EventMind remains OFF.

### TrustLink — PASS / trusted Gmail provider-auth code PASS / production writes OFF
- Zero-trust identity/linking: scoped hard keys, ambiguity -> REVIEW, hard conflict -> PENDING, lifecycle-only no-create.
- Merchant-scoped promotion requires explicit trusted `provider_adapter` sender authority; visible From/header auth alone cannot grant authority.
- Gmail provider-auth adapter now emits `trusted_sender_authority` only when the source provider is Gmail, the first `Authentication-Results` authserv-id is exactly `mx.google.com`, DMARC passes, and authenticated `header.from` exactly matches the normalized visible sender domain.
- Spoofed authserv-id, DMARC fail, domain mismatch, non-Gmail source and later-header spoofing all fail closed.
- Exact verified provider-auth head `2424d1d19bd975b7d2905f47352520abab93c50d`; CI #1188 / run `33666543307` PASS; verification PR #310 closed unmerged.
- Protocol: `protocols/TRUSTLINK-PROVIDER-AUTH-2026-09-02.md`.
- This closes the prior code-level direct-Gmail provenance gap in shadow/readiness evaluation. TrustLink production writes remain OFF until the Direct Gmail runtime/cursor gate passes and a separate production cutover is explicitly approved.

### JourneyGraph — PASS / isolated DB smoke PASS
- Multi-shipment aggregation, final delivery timestamp and monotonic physical progress fixed.
- Head `8ef8d36bb9f0ee7ebce3477c13e30f510df30e4f`; CI #1183 PASS.
- Migration `20260902153000_fix_journeygraph_multishipment_aggregate.sql` passed isolated Supabase smoke.
- Production migration NOT APPLIED.

### DocVault — PASS / isolated DB smoke PASS
- PDF SHA identity/immutability, ownership/source checks and private-read scoping fixed.
- Head `e77a226f403c6d5141e91d32d277bc99ce91ac21`; CI #1184 PASS.
- Migrations `20260902161000_prepare_docvault_owner_columns.sql` + `20260902162000_harden_docvault_content_identity.sql` passed isolated smoke including legacy owner backfill, idempotent same-PDF retry, conflicting hash rejection and cross-user rejection.
- Production migrations NOT APPLIED.

### Core — PASS / isolated DB smoke PASS / legacy writes OFF
- Old visible-From lifecycle trigger removed in prepared migration; legacy create/enrich/payment RPCs fail closed; Shipment/DocVault lanes preserved.
- Head `326b6481fc74c9f367a841f334ecd22928030012`; CI #1185 PASS.
- Migration `20260902170000_harden_core_purchase_authority.sql` passed isolated smoke; service-role-only RPC privileges verified.
- Production migration NOT APPLIED.

### Pulse — PASS
- One server-side Purchase status/next-action projection from persisted Purchase + all Shipments; REVIEW/PENDING precedence; no first-Shipment over-promotion.
- Head `df75e04989afd89df080942adcf31cb4ee4ec2d4`; CI #1187 PASS.
- No push engine or production write authority added.

## CONTROLLED DATABASE SMOKE — PASS

Protocol: `protocols/STAGING-SMOKE-2026-09-02.md`.

The old `BuyFlow-Staging` project is on a stale/incompatible schema lineage and was not migrated. A separate synthetic `BuyFlow-Smoke-Test` project reproduced the production-required baseline and exercised JourneyGraph -> DocVault bridge -> DocVault -> Core migrations.

Results: all target migrations PASS; production read-only preflight found 9 documents, 0 orphan documents, 0 conflicting invoice-hash groups, 1 multi-shipment Purchase and 0 inconsistent multi-shipment aggregate states.

Cleanup: `BuyFlow-Smoke-Test` INACTIVE; original `BuyFlow-Staging` restored ACTIVE_HEALTHY; production `buyflow-v3` untouched.

## DEPLOYMENT STATE

Still OFF / conservative:
- direct Gmail runtime OFF;
- Direct Gmail runtime-state migration NOT APPLIED production;
- source archive OFF;
- EventMind V11 runtime OFF;
- TrustLink production writes OFF;
- legacy automatic Purchase/payment writes OFF;
- JourneyGraph/DocVault/Core production migrations NOT APPLIED;
- no provider cutover;
- no AI identity authority;
- no production Purchase/Shipment/Document/Identity authority change.

## NEXT ACTION — REMAINING PRE-PRODUCTION GATES

1. **RawVault controlled storage/retention/orphan/account-deletion cleanup smoke** remains required. The separate Smoke-Test project is currently INACTIVE and cannot be restored while production + the actively-used old staging consume the Free-plan active-project slots; do not stop an active environment merely to force this test.
2. **MailGate cursor/history gate:** prepare a controlled readonly Direct Gmail runtime environment containing the committed runtime-state migration + readonly OAuth; then prove live `historyId` capture and `history.list` replay with **no checkpoint/source/archive/AI/domain writes**.
3. After gates 1–2 pass, perform a final release/cutover review. Production database migrations and TrustLink writes remain OFF until that explicit decision.
4. Other mailbox/provider adapters must define their own trusted provider-authentication policy; they must not inherit Gmail authority automatically.
5. Do not promote V12.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból. 9 modulos audit PASS; JourneyGraph/DocVault/Core isolated DB smoke PASS; TrustLink direct-Gmail provider-auth code path PASS on CI #1188; MailGate real Gmail RAW/read-only smoke PASS 6/6 but live historyId/history.list remains BLOCKED because Direct Gmail runtime state/OAuth is not deployed; RawVault real private-storage/retention cleanup smoke also remains. Production remains OFF. Next: finish RawVault + MailGate environment-dependent gates, then final cutover review.**
