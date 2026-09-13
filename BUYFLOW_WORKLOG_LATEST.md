# BuyFlow — latest worklog entry

## 2026-09-13 — Offline app-readiness simulation

- Tested main bc52a72cef4d6b972d8c40c3b124c0ca6ce89f65. New reusable runner: scripts/testlab/app-readiness-simulation.mjs; aggregate report: docs/audits/2026-09-13-app-readiness.json and Hungarian explanation alongside it.
- 155 legacy parser fixtures: demo 20/20 required positives, no negative false positives; diverse set 9/70 commerce recognized; web-derived set 3/24 recognized. These are direct parser component counts, NOT full current ingestion, write-authority or Luna accuracy.
- Production UI functions executed directly from TypeScript AST: 4/7 message cases correct; refunded-after-delivery, pickup-ready and label-created are wrong. No copied UI logic; not a browser render test.
- Orchestration/write-gate/MailLens/mock Responses checks passed. No actual Luna call, DB write, provider ingestion, document download or authenticated E2E. No runtime modification. Next: fix the three reproduced UI semantics and run full isolated provider/database/browser journey with real Luna.

