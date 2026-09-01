# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-09-01 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Modern email source:** PR #295 (draft)  
**Mobile cleanup:** PR #297 (draft)  
**V11 Fresh Blind:** PR #299  
**V11 representation diagnostics:** PR #300 / PR #301  
**V12 robustness foundation:** `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

## SAFETY CONTRACT

- Qwen may classify commerce/lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Frozen evaluation rows remain non-trainable.
- Direct Gmail/source archive/Mailgun source persistence stay OFF by default.
- No raw customer email content or secrets in Git.

## CURRENT V11 EVIDENCE

Completed local Qwen3-8B V11 QLoRA: 5760 TRAIN / 576 validation, 18 labels, multilingual, 1440/1440 optimizer steps, best in-family validation loss about `0.000015`. Protected holdouts were not trained/read.

Fresh Blind v1 first score (frozen SHA `6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`):
- exact `163/180 = 90.56%`
- commerce `173/180 = 96.11%`
- invalid `7`
- unsafe `1`
- critical boundary errors `10`
- gate `FAIL`

Untouched Input View Holdout v2 (frozen SHA `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`):
- FULL normalized input: `170/180 = 94.44%`, invalid `6`, unsafe `1`, critical `4`, mean tokens `404.4`
- SEMANTIC: `169/180 = 93.89%`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180 = 93.33%`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

FULL means production-shaped `NormalizedEmailDocumentV1`, not raw MIME/base64.

The add-back + causality diagnostics on `IVH2-0057` showed prompt-shape/token-position sensitivity: real, dummy and neutral additions could independently flip the prediction. Therefore do not add random technical fields to a compact view based on one row. Keep FULL normalized input as the current V11 baseline.

## V12 TEACHER + ROBUSTNESS FOUNDATION

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Protocol:
`protocols/V12-TEACHER-ROBUSTNESS-FOUNDATION-2026-09-01.md`

V12 direction:
1. eliminate malformed semantic output structurally before retraining;
2. create new teacher-reviewed hard-example siblings around real failure families, never frozen rows;
3. add representation-invariance augmentation (field order, harmless metadata padding/dropout, equivalent layouts);
4. train V12 only on newly approved/deidentified data;
5. freeze a completely new untouched holdout after training.

Teacher design: synthetic/deidentified by default. If an external OpenAI teacher is used, use the Responses API with strict JSON-schema output, configurable teacher model, environment-only API key, checkpoint/resume and provenance. No raw customer email goes to an external teacher by default.

## V12 STAGE 0 — INVALID-ONLY CONSTRAINED DECODING SCORED

The 6 invalid FULL outputs from Input View Holdout v2 were rerun with the existing V11 weights unchanged and a constrained decoder that permits only the 18 legal canonical outputs.

Result:
- selected invalid cases: `6`
- exact correct after constrained decoding: `6/6`
- constrained invalid output: `0`
- unsafe promotions: `0`
- all six were expected `ORDER_PROCESSING`
- no training, no adapter mutation, no fixture mutation

Local report:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/v12-output-constraint-invalid-v1.json`

Interpretation: malformed generative output can be eliminated on these six rows without retraining. This is strong but not yet a global adoption proof because only previously-invalid rows were rerun.

## V12 STAGE 0B — FULL 180 CONSTRAINT CONFIRMATION

The same runner supports `--all` and has launchers:
- `scripts/run-v12-output-constraint-full-v1.ps1`
- `scripts/BuyFlow-V12-OUTPUT-CONSTRAINT-FULL.cmd`

First launch attempt failed before model inference because the PowerShell WSL-path converter replaced double backslashes instead of normal single Windows path separators. No holdout row was rerun and no model result was produced. The launcher was fixed in commit `fc9e843d0b34d682d705cc649660c84ceb83001f` to use the same single-backslash conversion as the already-working probe launcher.

Adoption gate remains:
- constrained invalid outputs = `0`
- no increase in unsafe promotions
- no harmful changes to previously-valid predictions
- exact accuracy should improve or at minimum not regress materially

This is still diagnostic only; the frozen holdout remains non-trainable.

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the existing separate test worktree.
2. Rerun `scripts/BuyFlow-V12-OUTPUT-CONSTRAINT-FULL.cmd` after the WSL-path fix.
3. Preserve the first successful full-180 `# SUMMARY` and JSON report unchanged.
4. If the full constrained run is clean, treat constrained semantic decoding as the V12 output baseline and build the teacher-student hard-example corpus + representation-invariance generator next.
5. Do not train on Fresh Blind v1 or Input View Holdout v2 rows.
6. Keep frozen108 and BLIND50 untouched for tuning.
7. Qwen remains semantic-only; Zero-Trust Purchase Identity Graph remains authoritative.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
