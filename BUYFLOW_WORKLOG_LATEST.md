# BuyFlow — latest worklog entry

## 2026-09-13 — Audit repair 2: recoverable source extraction (in progress)

- Branch `fix/recoverable-processing-and-ui`, based on main `c39a36e43fc00bcc14471098e3d05c726ef55e7b`.
- Five-minute source claims fence stale workers; audit and review result save atomically. Explicit 60-second OpenAI request deadline; configuration checked before claiming.
- Busy source processing now retries through the shared webhook/scan path. Recovery requeues expired sources even when an older webhook was already acknowledged, preserving active locks and retry backoff.
- Synthetic PostgreSQL regressions cover stale/duplicate completion, rollback, reclaim, release, legacy unleased rows, durable recovery and client RPC permissions.
- Local API typecheck and 802 tests PASS. Database CI, migration application and exact deployment verification remain pending; this batch is not yet live.
- Remaining audit work: UI status/pagination, multi-account recovery, SES readiness and MailLens integration; real-mail and authenticated browser E2E remain unverified.

