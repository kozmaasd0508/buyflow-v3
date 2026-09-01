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
**V11 untouched input-view holdout:** `codex/v11-input-view-holdout-v2`

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

Evidence from the completed training:
- TRAIN 5760 / VALIDATION 576
- 18 event types, multilingual
- optimizer steps 1440 / 1440
- best validation loss about `0.000015`
- adapter saved under `best/`
- `frozen_108_trained=false`
- `blind_50_trained=false`
- final trainer status `LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE`

Do not treat the very low in-family validation loss as proof of real generalization.

## V11 FRESH BLIND V1 — SCORED / FAIL

Frozen fixture SHA-256:
`6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

First completed GPU result:
- exact: `163/180 = 90.56%`
- commerce: `173/180 = 96.11%`
- macro event accuracy: `90.56%`
- invalid output: `7`
- unsafe lifecycle promotions: `1`
- OTHER -> commerce false positives: `0`
- critical boundary errors: `10`
- gate: `FAIL`

Weakest event groups: `ORDER_PROCESSING 4/10`, `SHIPPED 5/10`, `OUT_FOR_DELIVERY 8/10`, `CANCELLED 8/10`.

First result lives locally under:
`local-data/lora-v11/fresh-blind-v1/runs/20260831T172252Z/`

Freeze rule remains active: do not patch or train on these 180 cases.

## V11 SEMANTIC EMAIL VIEW A/B V1 — SCORED / DIAGNOSTIC

PR #300 compares the same V11 adapter and same locked 180 cases using the full document versus `BuyFlowSemanticEmailViewV1`.

Result:
- full exact: `163/180 = 90.56%`
- semantic exact: `163/180 = 90.56%`
- invalid: `7 -> 7`
- unsafe promotions: `1 -> 0`
- critical boundary errors: `10 -> 10`
- paired wins: semantic-only `2`, full-only `2`, net `0`
- recommendation: `NO_CLEAR_ACCURACY_GAIN_REQUIRES_NEW_UNTOUCHED_HOLDOUT`

This showed a safety signal but no clean accuracy gain. Do not use the old 180 to choose the final representation.

## V11 INPUT VIEW HOLDOUT V2 — FROZEN / NOT YET SCORED

Branch: `codex/v11-input-view-holdout-v2`

Purpose: settle the representation question on a new untouched fixture by comparing three views with the unchanged V11 adapter:
- `FULL` — full production-shaped `NormalizedEmailDocumentV1`
- `SEMANTIC` — `BuyFlowSemanticEmailViewV1`
- `MINIMAL` — sender domain, subject, body text, visible HTML text, selected structured identifiers, attachment name/type

Frozen contract:
- 180 new cases, 18 events × 10
- hu/en/de/pl/fr/es
- new seed, wording, merchants, carriers and perturbation layout
- fixture SHA-256: `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`
- same V11 adapter, same instruction, same decoding and scorer across all three views
- records exact/macro/safety/critical-boundary metrics plus prompt-token cost and paired wins
- per-case checkpoint + resume
- no training
- no Fresh Blind rows reused
- frozen108 / BLIND50 / real Gmail holdout remain unread
- do not train on this fixture after scoring

Files:
- `scripts/v11_input_view_holdout_v2_fixture.py`
- `scripts/v11_input_views_v2.py`
- `scripts/v11-input-view-holdout-v2.py`
- `scripts/run-v11-input-view-holdout-v2.ps1`
- `scripts/BuyFlow-V11-INPUT-VIEW-HOLDOUT-V2.cmd`
- `protocols/V11-INPUT-VIEW-HOLDOUT-V2-2026-09-01.md`

## NEXT ACTION

1. Fetch `codex/v11-input-view-holdout-v2` into a separate worktree because the local main project folder points at `buyflow-app` and contains unrelated local changes.
2. Run `scripts/BuyFlow-V11-INPUT-VIEW-HOLDOUT-V2.cmd`.
3. Preserve the first `metrics.json` unchanged and compare FULL vs SEMANTIC vs MINIMAL, especially exact accuracy, unsafe promotions, invalid outputs, critical boundaries and mean prompt tokens.
4. Only after this result choose the V12 input representation.
5. Do not consume BLIND50/frozen108 for tuning yet.
6. Qwen remains semantic-only; Purchase Identity Graph remains authoritative for identity/linking.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
