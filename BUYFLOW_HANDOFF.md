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

First completed GPU result supplied from the user's local machine:
- exact: `163/180 = 90.56%`
- commerce: `173/180 = 96.11%`
- macro event accuracy: `90.56%`
- invalid output: `7`
- incoherent output: `0`
- unsafe lifecycle promotions: `1`
- OTHER -> commerce false positives: `0`
- critical boundary errors: `10`
- gate: `FAIL`

Weakest event groups:
- `ORDER_PROCESSING`: `4/10`
- `SHIPPED`: `5/10`
- `OUT_FOR_DELIVERY`: `8/10`
- `CANCELLED`: `8/10`

The first result lives locally under:
`local-data/lora-v11/fresh-blind-v1/runs/20260831T172252Z/`

Freeze rule remains active: do not patch this fixture and do not train on these 180 cases.

## V11 SEMANTIC EMAIL VIEW A/B V1 — SCORED / DIAGNOSTIC

PR #300 compares the same V11 adapter and same locked 180 cases using the full `NormalizedEmailDocumentV1` baseline versus compact `BuyFlowSemanticEmailViewV1` input. It is diagnostic only; no training occurred.

Local GPU A/B result:
- baseline exact: `163/180 = 90.56%`
- semantic exact: `163/180 = 90.56%`
- semantic macro event accuracy: `90.56%`
- invalid output: `7 -> 7`
- unsafe lifecycle promotions: `1 -> 0`
- critical boundary errors: `10 -> 10`
- paired wins: semantic-only `2`, baseline-only `2`, net `0`
- recommendation: `NO_CLEAR_ACCURACY_GAIN_REQUIRES_NEW_UNTOUCHED_HOLDOUT`

Interpretation:
- trimming technical input did **not** improve headline exact accuracy on this already-used diagnostic fixture;
- it did remove the one unsafe lifecycle promotion without increasing invalid outputs;
- this is a safety/efficiency signal, not proof that SemanticEmailView is globally better;
- do not adopt or train around this 180-case result without a newly frozen untouched representation holdout.

Semantic A/B result lives locally under:
`local-data/lora-v11/semantic-view-ab-v1/runs/20260901T180628Z/`

## NEXT ACTION

1. Preserve both first-run result directories unchanged.
2. Do **not** train on the 180-case Fresh Blind fixture.
3. Before V12, decide between two controlled next experiments: a newly frozen untouched representation holdout for full-vs-semantic input, and a hard-example V12 design targeting `ORDER_PROCESSING`, `SHIPPED`, critical boundaries and invalid-output elimination.
4. Do **not** consume BLIND50/frozen108 for tuning unless explicitly choosing them as evaluation gates.
5. Qwen remains semantic-only; Purchase Identity Graph remains authoritative for identity/linking.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
