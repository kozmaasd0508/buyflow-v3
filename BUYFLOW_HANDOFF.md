# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-09-01 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Identity architecture base:** `codex/v9-real-gmail-identity-shadow`  
**Modern email source:** `codex/modern-email-source-foundation-v1` / PR #295 (draft)  
**Mobile cleanup:** `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)  
**V11 fresh blind:** `codex/v11-fresh-blind-v1` / PR #299 (draft)  
**V11 semantic input diagnostic:** PR #300  
**V11 untouched input-view holdout + diagnostics:** `codex/v11-input-view-holdout-v2` / PR #301 (draft)

## SAFETY CONTRACT

- Qwen may classify commerce/lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Direct Gmail runtime/source archive/Mailgun source persistence remain OFF by default.
- No raw customer email content is committed to Git.
- Frozen evaluation rows remain non-trainable.

## MODERN EMAIL SOURCE / MOBILE

PR #295 contains production `NormalizedEmailDocumentV1`, structured-data extraction, source archive design, direct Gmail REST/history/watch/OAuth/PKCE, authenticated Pub/Sub and read-only shadow smoke. No live provider cutover/migration is claimed.

PR #297 contains mobile purchase-detail cleanup; exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 / 1286 API tests. Browser visual smoke remains pending.

## QWEN V11 TRAINING

Completed local Qwen3-8B QLoRA run:
`local-data/lora-v11/runs/20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic`

Evidence: 5760 train / 576 validation, 18 labels, multilingual, 1440/1440 optimizer steps, best in-family validation loss about `0.000015`, adapter saved, protected holdouts not trained/read. Do not treat the very low in-family validation loss as real-world proof.

## FRESH BLIND V1 — SCORED / FAIL

Frozen SHA: `6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`

First score: exact `163/180 = 90.56%`, commerce `173/180 = 96.11%`, invalid `7`, unsafe `1`, critical-boundary errors `10`, gate `FAIL`. Weakest groups included ORDER_PROCESSING and SHIPPED. Do not train on these rows.

## INPUT VIEW HOLDOUT V2 — SCORED

PR #301. Frozen SHA: `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`

First untouched 180-case result:
- FULL: `170/180 = 94.44%`, invalid `6`, unsafe `1`, critical `4`, mean prompt tokens `404.4`
- SEMANTIC: `169/180 = 93.89%`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180 = 93.33%`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

FULL here is normalized `NormalizedEmailDocumentV1`, not raw MIME/base64. The 6 invalid outputs across all views are a separate output-architecture issue.

Local metrics:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/metrics.json`

## ADD-BACK V1 — SCORED / IMPORTANT CAUTION

Only one holdout case was FULL-correct and SEMANTIC-wrong: `IVH2-0057`, expected `IN_TRANSIT`, Semantic predicted `OUT_FOR_DELIVERY`.

Starting from Semantic view:
- raw HTML: did not recover
- recipients: recovered
- headers/authentication: recovered
- provider metadata: did not recover
- raw links: recovered
- raw attachments: did not recover
- pipeline metadata: did not recover
- all omitted fields: recovered

Because three semantically unrelated groups (`recipients`, `headers/auth`, `raw links`) independently flipped the same single case to correct, do **not** infer that these fields are lifecycle evidence. The stronger hypothesis is prompt-shape/token-position sensitivity in the V11 generative classifier.

Local add-back report:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/input-view-addback-v1.json`

## CAUSALITY DIAGNOSTIC V1 — PREPARED

New diagnostic files on PR #301:
- `scripts/v11-input-view-causality-v1.py`
- `scripts/run-v11-input-view-causality-v1.ps1`
- `scripts/BuyFlow-V11-INPUT-VIEW-CAUSALITY.cmd`

It tests the same already-used FULL-only case with:
- real recipients / headers-auth / raw-links add-backs;
- dummy versions with similar structure but neutral values;
- neutral padding targeted to similar prompt lengths.

Purpose: separate useful email evidence from mere prompt/token-position effects. Diagnostic only; no training and no fixture mutation.

## NEXT ACTION

1. Pull latest `codex/v11-input-view-holdout-v2` in the separate test worktree and run `scripts/BuyFlow-V11-INPUT-VIEW-CAUSALITY.cmd`.
2. If dummy/neutral variants also recover `IVH2-0057`, treat the add-back effect as representation sensitivity and do not add recipients/auth/links to SemanticViewV2 just because they flipped one case.
3. Separately address the 6 invalid outputs using constrained/structured decoding or a sequence-classification head.
4. Then design V12 teacher-student hard-example training from failure families, never frozen rows.
5. Do not consume BLIND50/frozen108 for tuning yet.
6. Qwen remains semantic-only; Purchase Identity Graph remains authoritative for identity/linking.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
