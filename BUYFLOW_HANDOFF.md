# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub state before changing runtime code.

**Last updated:** 2026-08-30 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Architecture base:** `codex/v9-real-gmail-identity-shadow` @ `2e05b435a9f4fbc6467477c02fac462004bfa183`  
**Extension branch:** `codex/modern-email-source-foundation-v1`  
**Extension PR:** #295 (draft) -> `codex/v9-real-gmail-identity-shadow`

## CURRENT STATE

Safety remains unchanged:
- AI/V9 may provide lifecycle semantics only, never hard identity.
- lifecycle-only mail cannot create Purchase.
- hard conflicts -> REVIEW/PENDING.
- wrong auto-link / false Purchase create tolerance = 0.
- no modern email-source migration has been applied live.
- no new provider has been cut over into production.
- no raw customer email content is committed to Git.

## PURCHASE IDENTITY GRAPH V2 ALREADY EXISTS

Use/extend the existing `CanonicalEvent`, Purchase/Order/Shipment/Payment/Invoice identities, `EvidenceEdge`, `CorrelationDecision`, merchant identity and parent/child relation types. Do not build duplicate parallel graph concepts.

## MODERN EMAIL SOURCE FOUNDATION V1

PR #295 now contains:
- `NormalizedEmailDocumentV1` with provider full text + HTML + headers + attachments;
- bounded JSON-LD/schema.org extraction before AI;
- safe HTTP(S) link extraction;
- fail-closed DKIM/SPF/DMARC normalization;
- immutable raw + normalized object archive with SHA-256;
- opaque content-addressed object paths;
- deterministic trace id;
- retry-safe immutable-object verification;
- additive `source_emails` metadata migration + private `buyflow-email-source-v1` bucket;
- archive flag `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false` by default.

`persistNormalizedInboundEmail(...)` can archive source/provenance when deliberately enabled while Purchase/Shipment/Document/AI write counters remain zero.

The migration is committed only and has NOT been applied live.

## GMAIL INCREMENTAL PROVIDER V1

`GmailIncrementalEmailProvider` is implemented but not OAuth/runtime wired. It supports:
- Gmail search + full message fetch;
- full provider text/HTML/headers/attachment metadata;
- exact RAW MIME (`format=raw`);
- attachment bytes;
- initial `historyId` captured before snapshot scan;
- `history.list` created/updated/deleted replay;
- expired history -> `resetRequired=true`, no guessed cursor;
- Pub/Sub watch / renew / stop;
- externally supplied access token, never placed in URL/diagnostics.

## MAILGUN EXACT EML SOURCE PATH

The existing Mailgun shadow route now preserves full plain text and can pass an expanded forwarded `.eml` attachment's **exact bytes** into the immutable archive path.

This path has two independent operational gates and therefore remains OFF by default:
- `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false`
- `BUYFLOW_MAILGUN_SOURCE_PERSIST_ENABLED=false`

Only when both are explicitly enabled does Mailgun call source persistence. If enabled persistence/archive fails, the webhook fails closed with 503 so Mailgun can retry. Purchase/Shipment/Document writes remain disabled. The outer Mailgun form is never falsely reconstructed and called raw MIME; exact raw reference is supplied only when an actual `.eml`/`message/rfc822` attachment was captured.

## VERIFICATION

- CI #1092: rich normalizer/source archive GREEN.
- CI #1095: Gmail incremental provider GREEN after one test-only strict typing correction.
- CI **#1099** on Mailgun wiring code head `5cedbed5f0a3aef8aef28090f607823adc4cdfdf`: API typecheck/tests/build PASS; mobile typecheck/build PASS.

After the final handoff/worklog commits, run one final exact-head CI before claiming the whole PR head green. Temporary PR #296 is CI-only and must close unmerged.

## NEXT ACTION

1. Add Gmail OAuth/token runtime adapter behind a disabled feature flag.
2. Persist Gmail history/watch cursor state separately from Purchase identity state.
3. Add synthetic + read-only Gmail smoke for full/raw message parity and cursor replay.
4. Only after migration/bucket review consider enabling source archive for a controlled shadow account.
5. After provider ingestion is stable, extend existing graph concepts with persisted review/projection tables; do not duplicate the in-memory graph.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
