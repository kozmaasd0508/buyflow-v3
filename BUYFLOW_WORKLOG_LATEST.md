# BuyFlow — latest worklog entry

## 2026-09-12 — Audit repair 1: identity conflicts and document access

- Baseline main: `766a23794406feea0dd60b7902eda5699cb3709e`; branch `fix/audit-identity-document-security`.
- Exact order/tracking/thread identities now veto conflicting automatic links even when soft evidence creates a large score gap. Contradictory candidates return REVIEW with no selected Purchase; consistent identities still link.
- Private attachment signing requires the fixed documents bucket and the authenticated user's canonical attachment path. Stored attachment external URLs cannot bypass this check.
- Migration removes direct client writes to nine commerce/evidence tables while preserving existing reads/RLS and backend privileges. It verifies effective table and column privileges and aborts if unsafe grants remain.
- Added isolated PostgreSQL CI coverage: execute denied client INSERT/UPDATE/DELETE and preserved backend writes. The connected staging project uses a different schema and is not modified.
- Validation: 801/801 API tests and API/mobile build PASS. Disposable PostgreSQL tests confirmed denied client DML and preserved backend writes.
- PR #322 merged as `253de7f93fa45c08f48911d75a0fc77c64e5e8bd`. PR CI #34712428424, main CI #34712496392 and exact Render smoke #34712535387 all SUCCESS. Production `restrict_client_commerce_writes` migration applied; live verification: 9 protected tables, 0 client write grants, RLS enabled and backend SELECT/INSERT/UPDATE preserved.
- Security advisors after migration: no new findings; existing leaked-password-protection warning and four backend-only RLS/no-policy informational findings remain.
- No historical data repair, AI/model change, protocol activation, SES activation or frontend change in this batch.
- Next: recoverable processing leases, SES readiness, unified UI status/pagination/multi-account search, and MailLens integration with real-mail E2E evaluation.
