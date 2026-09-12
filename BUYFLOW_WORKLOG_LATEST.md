# BuyFlow — latest worklog entry

## 2026-09-12 — Audit repair 1: identity conflicts and document access

- Baseline main: `766a23794406feea0dd60b7902eda5699cb3709e`; branch `fix/audit-identity-document-security`.
- Exact order/tracking/thread identities now veto conflicting automatic links even when soft evidence creates a large score gap. Contradictory candidates return REVIEW with no selected Purchase; consistent identities still link.
- Private attachment signing requires the fixed documents bucket and the authenticated user's canonical attachment path. Stored attachment external URLs cannot bypass this check.
- Migration removes direct client writes to nine commerce/evidence tables while preserving existing reads/RLS and backend privileges. It verifies effective table and column privileges and aborts if unsafe grants remain.
- Added isolated PostgreSQL CI coverage: execute denied client INSERT/UPDATE/DELETE and preserved backend writes. The connected staging project uses a different schema and is not modified.
- Local API tests: 801/801 PASS. API/mobile build and PR/database CI are release gates; production migration and exact Render verification must be checked separately.
- No historical data repair, AI/model change, protocol activation, SES activation or frontend change in this batch.
- Next: complete this release, then recoverable processing leases, SES readiness, unified UI status/pagination/multi-account search, and MailLens integration with real-mail E2E evaluation.
