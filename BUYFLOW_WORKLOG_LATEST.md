# BuyFlow — latest worklog entry

## 2026-09-13 — Deterministic authored-evidence boundary (in progress)

- Continues `fix/maillens-semantic-evidence` after `d4d79da02e0dfd4997972d6503352a8370f14bed`.
- Reproduced an AI-independent write-authority bug: quoted Limone confirmation becomes order_created, and the existing validator marks it eligible_for_purchase_creation with non-review status. Also reproduced hidden historical cancellation becoming a lifecycle event.
- Shared deterministic evidence boundary now feeds lifecycle, commerce, Limone, GLS, Express One terminal receipt, generic lifecycle, provider-neutral inbound and Foxpost repair. It excludes known hidden/quoted subtrees and inherited reply subjects; empty/truncated current text cannot establish automatic parser authority.
- Preserved existing URL marker format for product parsers. Added Hungarian/Outlook quote boundaries and excluded document titles. Raw subjects/bodies remain unchanged for source storage; normalization metadata accompanies recognized results.
- Verification: 820 offline API tests PASS, API/mobile build PASS. Focused decision regression confirms old quoted-order automatic eligibility and its rejection after repair; genuine order, product quantity/URL and current cancellation still parse. No paid AI calls or customer data changes.
- GitHub PR creation remains blocked by connector internal error. No production deployment, migration or historical data repair. Existing stored decisions need a separate read-only audit; this change does not rewrite them. Full CSS rendering, unrecognized quote formats and real-mail accuracy remain limitations.

