# BuyFlow — latest worklog entry

## 2026-09-13 — Audit repair 2: recoverable source extraction (in progress)

- Branch `fix/recoverable-processing-and-ui`, based on main `c39a36e43fc00bcc14471098e3d05c726ef55e7b`.
- Five-minute source claims fence stale workers; audit and review result save atomically. Explicit 60-second OpenAI request deadline; configuration checked before claiming.
- Busy source processing now retries through the shared webhook/scan path. Recovery requeues expired sources even when an older webhook was already acknowledged, preserving active locks and retry backoff.
- Synthetic PostgreSQL regressions cover stale/duplicate completion, rollback, reclaim, release, legacy unleased rows, durable recovery and client RPC permissions.
- Local API typecheck, API/mobile build and 802 tests PASS. SQL recovery regressions also PASS on disposable PGlite PostgreSQL 18.3; this is not the required PostgreSQL 17 CI gate.
- Code saved to GitHub branch at `63e9e84fe3e0032f3101bcf0ef12049101178f0f` with a follow-up test/log commit. GitHub create_pull_request returned internal errors, and a subsequent PR-list read confirmed no PR exists. PostgreSQL 17 CI, production migration and exact deployment verification remain blocked/pending; this batch is not live.
- Remaining audit work: UI status/pagination, multi-account recovery, SES readiness and MailLens integration; real-mail and authenticated browser E2E remain unverified.

