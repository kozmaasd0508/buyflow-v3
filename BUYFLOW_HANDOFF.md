# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with current GitHub/live state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**MailGate/source branch:** `codex/modern-email-source-foundation-v1`  
**Architecture PR:** #295 draft -> `codex/v9-real-gmail-identity-shadow`

## SAFETY CONTRACT

- Qwen/AI may classify commerce/lifecycle semantics only; it never grants hard Purchase identity.
- Lifecycle-only email cannot create a Purchase.
- Multiple/hard-conflicting identity candidates remain REVIEW/PENDING.
- Direct Gmail runtime defaults OFF.
- Source archive defaults OFF.
- Mailgun source persistence defaults OFF.
- No direct-Gmail/source migration has been applied live from this development flow.
- No provider production cutover.
- No raw customer email bodies/secrets committed to Git.
- Pub/Sub/OAuth/provider cursor state has zero Purchase authority.

## MODULE AUDIT ORDER

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

The full audit started on 2026-09-02 after the V12 promotion gate failed. V11 remains the better current semantic model; V12 is not promoted.

## MAILGATE ROLE

MailGate owns provider connection and source acquisition only:
- securely authorize Gmail read-only;
- observe the configured mailbox discovery window without silently skipping source messages;
- obtain provider message/thread identity, headers, text/HTML, attachment metadata and exact RAW MIME when requested by the archive layer;
- maintain durable incremental cursor/watch state;
- tolerate duplicates/retries/races/provider cursor expiry;
- protect personal-mailbox privacy before persistence;
- never create/link/merge Purchase identity.

## MAILGATE AUDIT — CODE REMEDIATION COMPLETE

The first direct-Gmail audit found production blockers. They were remediated on behavior code head:
`e67b908e07d072e3737611eca4ee804d7d905c26`

Fixes:
1. Durable initial sync now exhausts the full discovery-query snapshot before cursor commit. Small `limit` values are page size for durable sync, not a silently truncated mailbox snapshot.
2. Gmail text/html or text/plain body parts stored behind `attachmentId` are fetched and hydrated before normalization.
3. Invalid/missing `internalDate` no longer fabricates 1970. Valid `Date` header is fallback; otherwise fail closed.
4. Gmail reads use bounded retry for transient network/408/429/5xx failures and bounded full-message concurrency.
5. Expired Gmail history cursor automatically triggers a complete recovery snapshot; the replacement cursor commits only after safe source handling.
6. Automatic watch renewal is scheduled before expiry.
7. Periodic cursor-based fallback synchronization runs independently of Pub/Sub so a missed push cannot silently stop ingestion.
8. OAuth now rejects unexpected extra Gmail authority, including `gmail.*` write scopes and the broad `https://mail.google.com/` scope.

Protocol:
`protocols/MAILGATE-DIRECT-GMAIL-AUDIT-REMEDIATION-2026-09-02.md`

## MAILGATE VERIFICATION

Temporary CI-only PR #296 / CI #1142 on exact behavior head `e67b908e07d072e3737611eca4ee804d7d905c26`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

Regression coverage includes complete initial pagination, detached body hydration, timestamp fail-closed behavior, retryable Gmail responses, and extra OAuth authority rejection.

Existing safety mechanisms remain:
- OAuth Authorization Code + PKCE;
- `gmail.readonly` least privilege;
- AES-256-GCM refresh-token encryption with user+connection+provider+key-version AAD;
- server-only credential/cursor tables;
- compare-and-swap cursor commit;
- authenticated Pub/Sub OIDC verification;
- durable Pub/Sub inbox with retry/dead-letter;
- Pub/Sub is wake-up only, never email/Purchase evidence;
- positive-commerce privacy gate before personal Gmail persistence;
- Purchase/Shipment/Document/AI write counters remain zero in this source lane.

## MAILGATE STATUS

**Code audit remediation: PASS.**

**Production MailGate: still BLOCKED pending controlled real-Gmail shadow smoke.**

Required shadow gate:
- direct Gmail runtime enabled only in controlled staging/test context;
- bounded message sample;
- exact RAW MIME available for every sampled message;
- valid captured Gmail cursor;
- history replay without guessed continuation;
- privacy-reduced counters only;
- 0 source persistence/archive in smoke;
- 0 Purchase/Shipment/Document writes;
- 0 AI calls;
- 0 mailbox mutations.

Do not enable production source persistence/archive or provider cutover before that smoke is green.

## SOURCE FOUNDATION / RAWVAULT CONTEXT

PR #295 also contains the future RawVault/MailLens foundation:
- `NormalizedEmailDocumentV1` with full plain text + HTML, headers, attachment metadata, structured data, safe links, authentication verdicts, raw-source ref, normalizer version and trace id;
- immutable content-addressed RAW MIME + normalized JSON archive with SHA-256 and opaque object keys;
- raw bytes in private object storage, not inline Postgres;
- archive flag OFF by default.

These parts have not yet received the new module-by-module audit verdict. Do not treat earlier green CI as a completed RawVault or MailLens audit.

## NEXT ACTION

1. Keep PR #295 draft and all live flags OFF.
2. If controlled Google/Supabase staging credentials are available, run the read-only `gmail:direct-shadow-smoke` gate and record exact evidence.
3. Until that live smoke exists, MailGate production status remains BLOCKED despite code remediation PASS.
4. Continue the module audit with **RawVault** next; inspect immutable source archive boundaries, retention, object integrity/idempotency, privacy, failure/orphan behavior and DB/object-store consistency.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
