# Phase E — 100 real Gmail blind freeze

Date: 2026-08-26
Base commit: `c312b7f591f8a1dc606d9b71af08fa30893d4ef0`
Mode: shadow only · 0 production writes · 0 AI

## Selection freeze

The private Gmail candidate set was selected **before message contents were read for this audit**.

Fixed Gmail-native queries and requested counts:

1. `after:2026/05/01 before:2026/07/01 category:purchases -in:spam -in:trash` → first 60 results
2. `after:2026/05/01 before:2026/07/01 category:updates -in:spam -in:trash` → first 20 results, then deduplicated against bucket 1 → 14 new cases
3. `after:2026/05/01 before:2026/07/01 category:promotions -in:spam -in:trash` → first 26 results

Frozen unique total: **100 cases**.

No Gmail message id, subject, body, recipient, personal address, order number, tracking number, payment reference or other raw private value is committed to the repository.

## Audit rule

The current stable v2 code is frozen for the first score. No parser, extraction, correlation or promotion-readiness production logic may be changed before the first result is recorded.

Acceptance is precision-first:

- any wrong automatic `CREATE_PURCHASE` or `LINK_EVENT` is a hard FAIL;
- any automatic cross-merchant / wrong-order link is a hard FAIL;
- any automatic promotion of frozen promotional-noise controls is a hard FAIL;
- REVIEW / UNLINKED / no event is an acceptable safe miss;
- all execution must remain 0-write and 0-AI;
- reports must be privacy-reduced and contain no raw purchase identifiers or message content.

## Execution

The private runner may fetch the frozen messages from the connected Gmail account through the existing Nylas grant at runtime. Raw message content exists only in runner memory. Only aggregate counts and privacy-reduced decision metadata may be printed.
