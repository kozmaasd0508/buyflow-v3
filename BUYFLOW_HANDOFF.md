# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-08-31 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Identity architecture base:** `codex/v9-real-gmail-identity-shadow`  
**Modern email source:** `codex/modern-email-source-foundation-v1` / PR #295 (draft)  
**Mobile cleanup:** `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)  
**V11 fresh blind:** `codex/v11-fresh-blind-v1`

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

Evidence from the user-provided final training log:
- TRAIN 5760 / VALIDATION 576
- 18 event types, multilingual
- optimizer steps 1440 / 1440
- best validation loss about `0.000015`
- adapter saved under `best/`
- `frozen_108_trained=false`
- `blind_50_trained=false`
- final trainer status `LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE`

Do not treat the very low in-family validation loss as proof of real generalization.

## V11 FRESH BLIND V1 — FROZEN, NOT YET SCORED

Branch: `codex/v11-fresh-blind-v1`

Protocol:
`protocols/V11-FRESH-BLIND-V1-2026-08-31.md`

Runner files under `scripts/`:
- `BuyFlow-V11-FRESH-BLIND.cmd`
- `run-v11-fresh-blind-v1.ps1`
- `v11-fresh-blind-v1.py`
- `v11_fresh_blind_config.py`
- `v11_fresh_blind_corpus.py`
- `v11_fresh_blind_fixture.py`
- `v11_fresh_blind_model.py`
- `v11_fresh_blind_score.py`

Fresh fixture contract:
- 180 new synthetic cases
- 18 events × 10
- languages: hu/en/de/pl/fr/es
- production `NormalizedEmailDocumentV1` top-level shape
- raw customer data = false
- train eligible = false
- frozen SHA-256 = `6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

Local static verification in the preparation environment:
- all Python modules compile
- `--freeze-only` regenerates exactly 180 cases and the frozen SHA above
- ZIP integrity check passes

PASS gate requires:
- invalid outputs = 0
- incoherent outputs = 0
- unsafe lifecycle promotions = 0
- OTHER -> commerce false positives = 0
- exact accuracy >= 90%
- macro event accuracy >= 85%

The first real V11 GPU inference on these 180 cases has **not** been run from this chat because the saved adapter exists only on the user's local machine. Do not claim a score until the user runs the launcher and provides the RESULT/metrics.

Freeze rule: after first score, do not patch this fixture and do not train V11 on it. Analyze failures only; corrections belong to a later model version and a future holdout.

## NEXT ACTION

1. Run `scripts/BuyFlow-V11-FRESH-BLIND.cmd` on the machine containing the completed V11 adapter.
2. Preserve the first `metrics.json` unchanged.
3. If Fresh Blind v1 is acceptable, then evaluate `frozen108`, `BLIND50`, and finally a real Gmail holdout.
4. Qwen remains semantic-only; Purchase Identity Graph remains authoritative for identity/linking.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
