# EventMind Teacher Mode V1 — 2026-09-04

## Why this exists

REAL120 chunk + short-evidence final judge proved runtime stability but only reached 44/120 strict exact. The dominant remaining semantic failures are:

- OTHER / merchant-outbound operations being misread as buyer lifecycle events;
- SHIPMENT_CREATED vs SHIPPED/later-stage confusion.

Instead of continuing to add prompt rules blindly, Teacher Mode creates supervised, interactive development conversations on known REAL120 mistakes. REAL120 is already a development set, so using its known ground truth for this purpose is scientifically acceptable. It cannot later be reused as the final unbiased holdout.

## V1 design

Development branch: `codex/buyflow-testlab-v1`.

Files:

- `apps/api/src/scripts/eventmind-teacher-mode-v1.ts`
- `scripts/run-eventmind-teacher-mode-direct.ps1`

Commits:

- `b2333db844abe66ab320a827a25359e235f9eb2c` — interactive Teacher Mode V1
- `18753f85737b30ddd9afb1283327631c3494b40e` — DIRECT one-click wrapper

The first active-learning queue targets known wrong REAL120 cases, prioritizing:

1. OTHER / merchant-outbound
2. SHIPMENT_CREATED
3. SHIPPED

The local Qwen3-8B + V11 adapter is used as the student. The teacher sees the current development example and a suggested Hungarian correction message. Blank ENTER sends the suggested message; free text allows a real back-and-forth conversation.

Commands:

- `/accept` — save the useful teaching conversation locally
- `/skip` — skip case
- `/full` — show full normalized semantic text locally
- `/done` — stop cleanly
- `/help` — command help

## Data handling

The teacher session intentionally has two outputs:

- private local JSONL under `Desktop/buyflow/local-data/teacher-mode/` containing the email text and teaching conversation for later local distillation/training;
- safe Desktop summary containing only hashes, labels, counts and technical metadata.

The private training session must **not** be committed to Git. Raw Gmail IDs are not written to the safe summary; only SHA-256 hashes are used there.

## Safety

- Gmail GET-only
- mailbox mutations 0
- BuyFlow DB writes 0
- production flags remain OFF
- no Purchase identity/link/create/merge authority is given to AI
- same pinned V11 runtime metadata checks and deterministic thinking-off runtime are reused
- teacher prompts are bounded; this is not a production runtime change

## Current status

**Prepared, not yet run/verified.** Do not claim Teacher Mode PASS until actual local output is provided.

## Next

Run the one-click DIRECT Teacher Mode. Start with a few high-value OTHER/merchant-outbound mistakes. After useful conversations are accepted, inspect the safe summary and then distill the private local sessions into a clean supervised training corpus. Only after corpus review should a new LoRA candidate be trained and compared on REAL120 development data.
