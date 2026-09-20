# BuyFlow — latest worklog entry

## 2026-09-20 — Luna logistics-boundary prompt v2.3 released (PR #331)

- Merge `1c670dd34d40d61f249fc1224a9f8f7a8c5370cd`; PR CI #35529312991, main CI #35529374707 and exact Render smoke #35529425612 SUCCESS. API/mobile typecheck, tests/builds and database/crash-recovery gates passed.
- Prompt audit version is `email-extraction-v2.3-logistics-boundaries`. New rules distinguish packed/waiting-for-courier merchant mail, courier pickup bookings, physical carrier acceptance, conditional pre-notifications, subscription charge receipts and COD/locker receipts; pickup/service request IDs cannot become tracking IDs without explicit parcel/tracking labels.
- Fresh current-MailLens REAL30 human-gold baseline before v2.3: Luna 22/30 exact (73.3%), Sol 27/30 (90%). Same tuning set after v2.3: Luna 29/30 exact (96.7%), identity 30/30, shipment_phase 30/30; Sol 28/30 (93.3%). These are tuning-set results, not unseen-mail generalization claims.
- AI remains observation-only; no DDL, customer-data rewrite, historical re-extraction or AI write-authority change.
- Next: build an unseen human-gold holdout through current MailLens before making a generalized Luna accuracy claim.
