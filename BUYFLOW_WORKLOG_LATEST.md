# BuyFlow worklog latest

## 2026-09-02 — MailGate real Gmail read-only smoke: PARTIAL PASS / history gate BLOCKED

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft

Real Gmail smoke completed without mailbox or BuyFlow writes:
- six recent purchase/lifecycle emails sampled;
- exact RAW MIME available **6/6**;
- observed normal authored-body vs RAW semantics consistent;
- attachment metadata present where expected;
- no detached renderable text-body occurred in this live slice, so detached live parity is not claimed;
- sampled UNREAD mail remained UNREAD;
- no Gmail mutation action called;
- production since smoke start: **0 source emails, 0 Purchase updates, 0 Shipment updates, 0 Documents, 0 AI runs**.

Remaining MailGate blocker:
- connected Gmail tool has no `history.list` and profile does not expose historyId;
- production `buyflow-v3` does not yet contain `email_provider_credentials` or `email_sync_states` and has 0 new-runtime direct Gmail connections;
- therefore live initial historyId capture + `history.list` replay were **NOT RUN**;
- no production migration was applied just to force this smoke.

Verdict:
- MailGate code: PASS;
- real Gmail RAW/read-only path: PASS;
- zero-write/zero-AI/mailbox mutation safety: PASS;
- live cursor/history replay: BLOCKED;
- full production MailGate gate: NOT YET PASS;
- direct Gmail runtime remains OFF.

Protocol: `protocols/MAILGATE-REAL-GMAIL-SHADOW-SMOKE-2026-09-02.md`.

Next actionable gate: **RawVault private-storage/retention/orphan/account-deletion cleanup smoke**. MailGate cursor/history is finished later in a controlled readonly Direct Gmail runtime environment.

---

## 2026-09-02 — Controlled JourneyGraph/DocVault/Core DB smoke PASS

A separate synthetic Supabase smoke project reproduced the required production baseline. JourneyGraph multi-parcel aggregation, DocVault ownership/content identity and Core fail-closed authority all passed. Production remained read-only; migrations remain unapplied. Smoke project is INACTIVE; old staging restored ACTIVE_HEALTHY.

Protocol: `protocols/STAGING-SMOKE-2026-09-02.md`.

---

## 2026-09-02 — 9-module code audit complete

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

All module code audits are complete. Production source/AI/write/cutover flags remain OFF. EventMind V11 first untouched 90-case gate remains preserved at 90/90 exact. TrustLink merchant production promotion still requires trusted provider-auth provenance. V12 remains unpromoted.
