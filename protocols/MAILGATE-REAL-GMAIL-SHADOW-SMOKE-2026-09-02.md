# MailGate real-Gmail read-only shadow smoke — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`
PR: #295 draft

## Safety boundary

This was a read-only live-mailbox observation only. No provider cutover, source persistence/archive, Purchase/Shipment/Document write, AI call, Gmail label mutation, watch registration, cursor commit or production migration was performed.

No raw customer email body, address, order number, payment data or Gmail message id is stored in this protocol. Cases are recorded only as S1–S6.

## Real Gmail sample

A bounded six-message sample was selected from recent Gmail purchase-category mail and read with exact RFC822 RAW MIME enabled.

Privacy-reduced sample composition:
- merchant order/lifecycle mail;
- merchant multi-parcel lifecycle mail;
- carrier lifecycle mail;
- invoice-bearing mail with PDF attachment;
- receipt mail with PDF attachments.

Results:
- exact RAW MIME available: **6/6**;
- parsed body vs RAW authored body semantics: **6/6 consistent**;
- PDF attachment metadata present where expected;
- normal MIME multipart/plain+HTML structures were handled as expected;
- no detached renderable text-body case was encountered in this six-message live sample, so detached-body live parity is **NOT CLAIMED**. That path remains regression-covered by the MailGate code suite.

## Mailbox mutation check

A sampled message that was `UNREAD` before/while reading remained `UNREAD` when read again after RAW inspection. No archive, Trash, label, send, draft or other mutation action was called.

Verdict: **mailbox read-only behavior PASS**.

## Production zero-write / zero-AI check

The smoke start boundary was `2026-09-02T17:54:00Z` (`19:54 Europe/Budapest`). Read-only production SQL after the mailbox sample showed since that boundary:
- `source_emails` created: **0**;
- Purchase rows updated: **0**;
- Shipment rows updated: **0**;
- Document rows created: **0**;
- AI processing runs created: **0**.

The production schema also does not currently contain the new raw/source archive tables, so this smoke could not archive source bytes there.

Verdict: **0 BuyFlow writes / 0 AI PASS**.

## Cursor / history gate

The exact MailGate contract requires both:
1. current Gmail `historyId` cursor capture; and
2. a real `users.history.list` replay.

This portion could not be executed in the current live environment without changing deployment state:
- the connected Gmail tool used for the read-only sample exposes message search/read and RAW MIME, but no Gmail history endpoint and its profile response does not expose `historyId`;
- production `buyflow-v3` currently has **no** `email_provider_credentials` table and **no** `email_sync_states` table;
- production has **0** direct Gmail connections under the new runtime contract;
- therefore migration `20260830222000_add_direct_gmail_runtime_state.sql` and a direct readonly Gmail OAuth runtime are not deployed there.

The code path itself remains CI/regression verified: `GmailIncrementalEmailProvider.initialSync(...)` requires a profile `historyId`, and `getChanges(...)` calls Gmail `history.list` with a numeric cursor. But code evidence is not substituted for the missing live replay.

Verdict: **initial cursor + history.list live gate BLOCKED / NOT RUN**.

## Overall MailGate result

- MailGate code remediation: **PASS**;
- bounded real Gmail read: **PASS**;
- RAW MIME availability: **PASS 6/6**;
- normal-body live parity: **PASS on observed sample**;
- detached-body live parity: **NOT OBSERVED / regression-covered only**;
- mailbox mutation safety: **PASS**;
- production zero writes: **PASS**;
- AI calls: **0 / PASS**;
- real initial `historyId` capture: **BLOCKED**;
- real `history.list` replay: **BLOCKED**.

Therefore **full MailGate production gate is NOT yet PASS**. Production direct Gmail runtime stays OFF. No migration or provider cutover is approved by this smoke.

## Required next MailGate step

Create a controlled direct-Gmail readonly runtime environment with the committed Gmail runtime-state migration and a readonly OAuth grant, then run exactly:
- profile/historyId capture;
- bounded complete initial snapshot without persistence;
- `history.list` replay from that cursor;
- no checkpoint commit, source archive, AI or Purchase/Shipment/Document mutation during the smoke.

Until that succeeds, keep direct Gmail production runtime OFF.
