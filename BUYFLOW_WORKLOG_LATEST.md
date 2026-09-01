# BuyFlow worklog latest

## 2026-09-01 — V11 untouched input-view holdout v2 scored

Branch: `codex/v11-input-view-holdout-v2` / PR #301 (draft)

First completed local GPU result on the newly frozen untouched 180-case holdout:

- FULL: `170/180 = 94.44%` exact, invalid `6`, unsafe `1`, critical `4`, mean prompt tokens `404.4`
- SEMANTIC: `169/180 = 93.89%` exact, invalid `6`, unsafe `2`, critical `5`, mean prompt tokens `259.2`
- MINIMAL: `168/180 = 93.33%` exact, invalid `6`, unsafe `2`, critical `6`, mean prompt tokens `178.2`
- FULL→SEMANTIC paired net: `-1`
- FULL→MINIMAL paired net: `-2`
- SEMANTIC→MINIMAL paired net: `-1`
- runner recommendation: `full`

Local metrics:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/metrics.json`

Interpretation:
- FULL wins accuracy and safety on the fresh untouched holdout.
- SEMANTIC saves about 36% mean prompt tokens but loses one exact case and worsens unsafe/critical counts.
- MINIMAL saves about 56% mean prompt tokens but loses two exact cases and worsens unsafe/critical counts further.
- FULL here means normalized production-shaped `NormalizedEmailDocumentV1`, not raw MIME/base64 email.
- The correct next optimization is not blind minimization: inspect paired FULL-only wins and preserve the missing evidence in a compact `SemanticEmailViewV2`.
- The same `6` invalid outputs in all three views indicate a separate generative-output problem; input trimming did not fix it.
- No training occurred; this frozen holdout remains non-trainable.

Next:
1. analyze preserved paired predictions and source documents for FULL-only/compact-only wins;
2. identify the minimum evidence set needed to retain FULL accuracy/safety;
3. prototype evidence-preserving compact view;
4. separately test structured/constrained output or classification-head architecture for invalid-output elimination;
5. only then design V12 teacher-student/hard-example training on newly generated sibling cases, never the holdout rows.

---

## 2026-09-01 — V11 untouched input-view holdout v2 frozen

Prepared a clean confirmation test for the email-representation question before V12.

Frozen holdout:
- 180 previously unused synthetic cases
- 18 lifecycle labels × 10
- hu/en/de/pl/fr/es
- fixture SHA-256 `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`
- FULL vs SEMANTIC vs MINIMAL on same unchanged V11 adapter
- same instruction, decoding, label set and scorer
- prompt-token cost + paired wins
- checkpoint/resume
- no training or protected holdout reads

---

## 2026-09-01 — V11 SemanticEmailView A/B diagnostic scored

Branch: `codex/v11-semantic-view-ab-v1` / PR #300 (draft)

Result on the already-used Fresh Blind fixture:
- FULL `163/180 = 90.56%`
- SEMANTIC `163/180 = 90.56%`
- invalid `7 -> 7`
- unsafe `1 -> 0`
- critical `10 -> 10`
- paired semantic-only `2`, full-only `2`, net `0`

Useful safety signal but insufficient to choose the representation; prompted the fresh untouched v2 holdout.

---

## 2026-08-31 — V11 Fresh Blind v1

Frozen 180-case post-training evaluation across 18 labels and six languages. First score:
- exact `163/180 = 90.56%`
- commerce `173/180 = 96.11%`
- invalid `7`
- unsafe `1`
- critical boundary errors `10`
- gate `FAIL`

Do not train on these rows.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1` / PR #295 (draft)

Direct Gmail OAuth/PKCE, encrypted refresh-token storage, incremental history/watch runtime, authenticated Pub/Sub wake-up handling and read-only Gmail shadow smoke are implemented behind disabled-by-default flags. No direct Gmail production cutover or live source migration has occurred.

---

## 2026-08-31 — Mobile Architecture Cleanup v1

Branch: `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)

Purchase-detail status/timeline/product rendering was consolidated, three legacy MutationObservers removed, stored product image preview added, shipment-facing UI renamed to **Csomagok**. Exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286/1286 API tests. Browser visual smoke remains pending.
