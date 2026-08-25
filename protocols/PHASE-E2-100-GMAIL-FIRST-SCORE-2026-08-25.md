# Phase E2 — 100-message fresh Gmail blind — FIRST SCORE

This score is recorded before any post-score production-code change.

## Frozen selection
- 100 real Gmail messages from June 2026.
- 70 from Gmail `category:purchases`.
- 30 outside Gmail `category:purchases`.
- Selection was frozen before reading message bodies.
- Raw Gmail identifiers and message content are not stored here.

## Exact live shadow run
- CI run: #1029
- Full-message fetch failures: 0
- Missing bodies: 0
- Missing headers: 0
- Production writes: 0
- AI calls: 0

## First score
- Messages: 100
- Canonical events emitted: 17
- No canonical event: 83
- `UNLINKED`: 16
- `REVIEW/PENDING`: 1
- Promotion eligible: 0
- `CREATE_PURCHASE`: 0
- `LINK_EVENT`: 0
- Unsafe automatic promotion observed: 0

## Interpretation
The run is fail-closed but too conservative to establish positive automatic-link precision on this holdout, because no case crossed the Phase E promotion gate. This is NOT a production-write pass. The next step is to diagnose the blocked known-positive cases without changing the frozen set or rewriting this first score.

Any post-score fix must be generic, evidence-based, privacy-safe, and re-run against the same 100-message selection. Merchant-specific subject patching remains prohibited.
