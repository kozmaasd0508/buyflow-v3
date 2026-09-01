# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-09-01 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Identity architecture base:** `codex/v9-real-gmail-identity-shadow`  
**Modern email source:** `codex/modern-email-source-foundation-v1` / PR #295 (draft)  
**Mobile cleanup:** `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)  
**V11 fresh blind:** `codex/v11-fresh-blind-v1` / PR #299 (draft)  
**V11 SemanticEmailView diagnostic:** `codex/v11-semantic-view-ab-v1` / PR #300 (draft)  
**V11 untouched input-view holdout:** `codex/v11-input-view-holdout-v2` / PR #301 (draft)

## SAFETY CONTRACT

- AI/Qwen may classify commerce/lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Direct Gmail runtime, source archive and Mailgun source persistence remain OFF by default.
- No modern email-source/direct-Gmail migration has been applied live from this development flow.
- No raw customer email content is committed to Git.

## MODERN EMAIL SOURCE + DIRECT GMAIL FOUNDATION

PR #295 contains `NormalizedEmailDocumentV1`, structured-data extraction, immutable raw/normalized archive design, direct Gmail REST + history/watch support, OAuth Authorization Code + PKCE, AES-256-GCM refresh-token storage, authenticated Pub/Sub wake-up handling, durable sync inbox and a read-only direct-Gmail shadow smoke. Live Google staging/shadow setup is still pending; do not claim provider cutover.

## MOBILE CLEANUP

PR #297 consolidated purchase-detail status/timeline/product rendering, removed three legacy MutationObservers, added stored product-image preview support, renamed shipment-facing UI to **Csomagok**, and passed CI #1139 on code head `b90670c9c7e4654537c060f99733b6d56ddb8553`. Browser visual smoke is still required before merge/APK.

## QWEN V11 TRAINING — COMPLETE

Completed local Qwen3-8B QLoRA run:
`local-data/lora-v11/runs/20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic`

Evidence:
- TRAIN 5760 / VALIDATION 576
- 18 event types, multilingual
- optimizer steps 1440 / 1440
- best validation loss about `0.000015`
- adapter saved under `best/`
- protected holdouts were not trained/read
- trainer status `LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE`

Do not treat the very low in-family validation loss as proof of real generalization.

## V11 FRESH BLIND V1 — SCORED / FAIL

Frozen SHA-256:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

First completed GPU result:
- exact `163/180 = 90.56%`
- commerce `173/180 = 96.11%`
- macro `90.56%`
- invalid `7`
- unsafe promotions `1`
- critical boundary errors `10`
- gate `FAIL`

Weakest groups: `ORDER_PROCESSING 4/10`, `SHIPPED 5/10`, `OUT_FOR_DELIVERY 8/10`, `CANCELLED 8/10`.

Do not patch or train on these 180 cases.

## V11 SEMANTIC EMAIL VIEW A/B V1 — SCORED / DIAGNOSTIC

PR #300 reused the locked Fresh Blind cases only as a diagnostic representation comparison.

Result:
- FULL `163/180 = 90.56%`
- SEMANTIC `163/180 = 90.56%`
- invalid `7 -> 7`
- unsafe `1 -> 0`
- critical `10 -> 10`
- paired semantic-only `2`, full-only `2`, net `0`

This was not enough to choose a representation, so a fresh untouched holdout was frozen.

## V11 INPUT VIEW HOLDOUT V2 — SCORED

PR #301. Frozen SHA-256:
`8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`

First completed local GPU result on 180 newly frozen cases:
- **FULL**: `170/180 = 94.44%`, invalid `6`, unsafe `1`, critical `4`, mean prompt tokens `404.4`
- **SEMANTIC**: `169/180 = 93.89%`, invalid `6`, unsafe `2`, critical `5`, mean prompt tokens `259.2`
- **MINIMAL**: `168/180 = 93.33%`, invalid `6`, unsafe `2`, critical `6`, mean prompt tokens `178.2`
- paired nets: FULL→SEMANTIC `-1`, FULL→MINIMAL `-2`, SEMANTIC→MINIMAL `-1`
- runner recommendation: `full`

Local result:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/metrics.json`

Interpretation:
- FULL is currently the best accuracy/safety representation on an untouched holdout.
- SEMANTIC saves about 36% prompt tokens but loses one exact case and worsens unsafe/critical counts.
- MINIMAL saves about 56% prompt tokens but loses two exact cases and worsens unsafe/critical counts further.
- FULL means normalized production-shaped `NormalizedEmailDocumentV1`, **not** raw MIME/base64 email.
- The 6 invalid outputs persist across all views, so malformed generative JSON is a separate output-architecture problem.
- Do not train on this 180-case holdout.

## INPUT-VIEW ADD-BACK DIAGNOSTIC — PREPARED

On the same already-scored holdout, a diagnostic-only add-back runner now tests only cases where FULL was correct and SEMANTIC was wrong. It starts from the compact SemanticEmailView and adds omitted evidence groups one at a time:
- raw HTML markup
- recipients
- headers/authentication
- provider/thread/folder metadata
- raw link details
- raw attachment details
- pipeline metadata
- all omitted groups together

Purpose: find the smallest evidence group that recovers FULL accuracy, so `SemanticEmailViewV2` can preserve useful evidence without carrying every technical field.

Files:
- `scripts/v11-input-view-addback-v1.py`
- `scripts/run-v11-input-view-addback-v1.ps1`
- `scripts/BuyFlow-V11-INPUT-VIEW-ADDBACK.cmd`

This diagnostic does not train, does not modify the frozen fixture, and must not make these rows train-eligible.

## NEXT ACTION

1. Pull the latest `codex/v11-input-view-holdout-v2` into the separate test worktree and run `scripts/BuyFlow-V11-INPUT-VIEW-ADDBACK.cmd`.
2. Use the add-back result to design an evidence-preserving `SemanticEmailViewV2` rather than blindly minimizing fields.
3. Separately address the 6 invalid outputs (constrained/structured decoding or sequence-classification head for `is_commerce + event_type`).
4. Then design V12 teacher-student hard-example training around the actual failure families, without training on frozen holdout rows.
5. Do not consume BLIND50/frozen108 for tuning yet.
6. Qwen remains semantic-only; Purchase Identity Graph remains authoritative for identity/linking.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
