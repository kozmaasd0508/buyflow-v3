# BuyFlow worklog latest

## 2026-09-01 — V11 untouched input-view holdout v2 frozen

Branch: `codex/v11-input-view-holdout-v2`

Prepared a clean confirmation test for the email-representation question before V12.

New frozen holdout:
- 180 previously unused synthetic cases
- 18 lifecycle labels × 10
- hu/en/de/pl/fr/es
- new seed `20260901`
- new merchant/carrier names, wording and perturbation layout
- production-shaped `NormalizedEmailDocumentV1` source document
- fixture SHA-256: `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`

A/B/C views on the same cases and unchanged V11 adapter:
- FULL: complete `NormalizedEmailDocumentV1`
- SEMANTIC: `BuyFlowSemanticEmailViewV1`
- MINIMAL: sender domain + subject + body text + visible HTML text + selected identifiers + attachment name/type

Controls and outputs:
- same instruction, decoding, label set and strict scorer for all views
- exact/macro/commerce, invalid, incoherent, unsafe, OTHER false-commerce and critical-boundary metrics
- prompt-token min/max/mean/total for cost comparison
- paired wins for FULL↔SEMANTIC, FULL↔MINIMAL and SEMANTIC↔MINIMAL
- per-case checkpointing and automatic resume
- no training and do not train on these 180 after scoring
- old Fresh Blind rows are not reused as evaluation rows
- frozen108 / BLIND50 / real Gmail holdout remain unread
- no Purchase/Identity/Gmail/DB writes

Launcher:
`scripts/BuyFlow-V11-INPUT-VIEW-HOLDOUT-V2.cmd`

Next: run locally from a separate `buyflow-v3` worktree, preserve first metrics unchanged, then choose V12 input representation from accuracy + safety + prompt-token cost.

---

## 2026-09-01 — V11 SemanticEmailView A/B diagnostic scored

Branch: `codex/v11-semantic-view-ab-v1` / PR #300 (draft)

Completed local GPU A/B using the same locked 180-case Fresh Blind fixture and the same V11 adapter.

Result:
- full `NormalizedEmailDocumentV1` baseline: `163/180 = 90.56%` exact
- `BuyFlowSemanticEmailViewV1`: `163/180 = 90.56%` exact
- semantic macro event accuracy: `90.56%`
- invalid output: `7 -> 7`
- unsafe lifecycle promotions: `1 -> 0`
- critical boundary errors: `10 -> 10`
- paired semantic-only correct: `2`
- paired baseline-only correct: `2`
- net exact gain: `0`
- recommendation: `NO_CLEAR_ACCURACY_GAIN_REQUIRES_NEW_UNTOUCHED_HOLDOUT`

Interpretation:
- compact semantic input did not improve headline accuracy on this diagnostic fixture;
- it removed the single unsafe promotion with no invalid-output regression;
- this is a useful safety/efficiency signal but not enough to adopt the representation yet;
- confirm on a newly frozen untouched representation holdout before V12/adoption;
- no training occurred and the 180 cases remain non-trainable.

Local result:
`local-data/lora-v11/semantic-view-ab-v1/runs/20260901T180628Z/`

---

## 2026-09-01 — V11 SemanticEmailView A/B diagnostic prepared

Branch: `codex/v11-semantic-view-ab-v1`

First V11 Fresh Blind v1 result from the user's local GPU run:
- gate: FAIL
- exact: 163/180 = 90.56%
- commerce: 173/180 = 96.11%
- macro event accuracy: 90.56%
- invalid output: 7
- unsafe lifecycle promotions: 1
- OTHER -> commerce false positives: 0
- critical boundary errors: 10
- weakest groups: ORDER_PROCESSING 4/10, SHIPPED 5/10, OUT_FOR_DELIVERY 8/10, CANCELLED 8/10

The frozen fixture remains unchanged and must not be trained on.

Implemented a diagnostic input-representation A/B test with `BuyFlowSemanticEmailViewV1`, same adapter/instruction, preserved baseline reuse, strict scorer, paired wins and per-case resume. No training or protected holdout reads.

---

## 2026-08-31 — V11 Fresh Blind v1 frozen runner prepared

Branch: `codex/v11-fresh-blind-v1`

Frozen 180-case post-training V11 fresh blind protocol covering all 18 lifecycle labels, six languages and critical boundary/noise traps. Frozen SHA-256:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1` / PR #295 (draft)

Direct Gmail OAuth/PKCE, encrypted refresh-token storage, incremental history/watch runtime, authenticated Pub/Sub wake-up handling and read-only Gmail shadow smoke are implemented behind disabled-by-default flags. No direct Gmail production cutover or live source migration has occurred.

---

## 2026-08-31 — Mobile Architecture Cleanup v1

Branch: `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)

Purchase-detail status/timeline/product rendering was consolidated, three legacy MutationObservers removed, stored product image preview added, shipment-facing UI renamed to **Csomagok**. Exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286/1286 API tests. Browser visual smoke remains pending.
