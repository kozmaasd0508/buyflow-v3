# BuyFlow — latest worklog entry

## 2026-09-20 — Luna-first selective Sol verification released (PR #333)

- Merge `2638ee1d93d12ef74443f0eb687137af4639555c`; final PR CI #35531231754, main CI #35531391000 and exact Render smoke #35531437379 SUCCESS. API/mobile typecheck, tests/builds and database/crash-recovery gates passed.
- Runtime policy `luna-first-selective-sol-v1`: Luna always runs first. Sol verifies only generic high-risk boundaries: evidence issues/low confidence, `order_updated`, shipment with missing phase, merchant `shipment_created` with both order+tracking, or ambiguous `order_created` below 0.99 confidence.
- Successful Sol verification becomes the selected AI observation; verifier failure falls back to Luna. Both remain `ai_shadow` / review-only and cannot create or mutate Purchase/Shipment/Document state.
- Audit metadata now records routing reasons, selected/primary/verifier models, core agreement, response IDs and combined token usage. `BUYFLOW_SOL_VERIFIER_ENABLED=false` is the operational kill switch.
- Disjoint unseen-by-thread REAL30 holdout: Luna-only 23/30 exact (76.7%); full Sol 28/30 (93.3%). Final selective rerun used Sol on 5/30 (16.7%) and scored 27/30 exact (90%), semantic 28/30 (93.3%), identity 28/30 (93.3%), with tracking/invoice/payment 30/30.
- Next: keep routing/cost monitoring observation-only; address receipt/order-link recovery and the remaining rescheduled-delivery phase edge, then validate any repair on a third unseen holdout.
