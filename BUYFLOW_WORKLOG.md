# BuyFlow V3 — persistent worklog

> Concise newest-first history. Older granular detail remains available in Git history and the dated `protocols/` files.

## 2026-09-02 — MailGate real Gmail read-only smoke: PARTIAL PASS / history gate BLOCKED

- Bounded six-message real Gmail purchase/lifecycle sample read with exact RAW MIME; RAW available **6/6**.
- Observed normal authored-body vs RAW semantics were consistent; PDF attachment metadata present where expected.
- No detached renderable text-body case occurred in the live six-message slice, so detached-body live parity is not claimed; regression coverage remains green.
- One sampled UNREAD message remained UNREAD after RAW inspection; no mailbox mutation action was called.
- Production read-only verification since smoke start: **0 source emails, 0 Purchase updates, 0 Shipment updates, 0 Documents, 0 AI runs**.
- Full MailGate cannot be called PASS yet: the connected Gmail tool exposes no `history.list` and no historyId in profile; production also lacks `email_provider_credentials` and `email_sync_states`, with 0 direct Gmail connections under the new runtime contract.
- No production migration was applied to fix that during the smoke. Direct Gmail runtime remains OFF.
- Protocol: `protocols/MAILGATE-REAL-GMAIL-SHADOW-SMOKE-2026-09-02.md`.
- Commits: protocol `49b17f37d64a2e279030303b019e2cf952c73434`; current-state handoff `fdb706546d7c18040dfb861f853c494daf4ba2e6`.
- Next actionable gate: RawVault private-storage/retention/orphan/account-deletion cleanup smoke. Remaining MailGate cursor/history proof needs a controlled readonly Direct Gmail runtime environment.

## 2026-09-02 — Controlled JourneyGraph/DocVault/Core DB smoke PASS

- Separate synthetic `BuyFlow-Smoke-Test` Supabase project used; production remained read-only.
- JourneyGraph multi-parcel aggregation + pickup monotonicity PASS.
- DocVault schema bridge/owner backfill/content hash conflict/cross-user blocking/immutability PASS.
- Core legacy create/enrich/payment fail-closed PASS; Shipment/DocVault lanes preserved; tested RPCs service-role-only.
- Production preflight: 9 documents, 0 orphan docs, 0 conflicting invoice-hash groups, 1 multi-shipment Purchase, 0 aggregate inconsistencies.
- Smoke project paused INACTIVE; old `BuyFlow-Staging` restored ACTIVE_HEALTHY.
- Protocol: `protocols/STAGING-SMOKE-2026-09-02.md`.

## 2026-09-02 — 9-module source-to-UI code audit complete

Audit order completed:
`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

Highlights:
- MailGate code remediation PASS, live cursor/history gate still pending.
- RawVault code PASS, storage/retention cleanup smoke pending.
- MailLens PASS.
- EventMind V11 first untouched 90-case GPU gate: 90/90 exact, 100% macro, invalid 0, unsafe 0; production OFF.
- TrustLink zero-trust PASS; trusted provider-auth provenance still required before merchant production promotion.
- JourneyGraph/DocVault/Core code + CI PASS; prepared production migrations remain unapplied.
- Pulse PASS; one server-side fail-closed status projection.

All production source/AI/write/cutover flags remain OFF. V12 remains unpromoted.
