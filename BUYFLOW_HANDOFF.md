# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with GitHub/live state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
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

Fresh Blind v1 first score: exact `163/180`, invalid `7`, unsafe `1`, critical-boundary errors `10`, gate `FAIL`.

Untouched Input View Holdout v2:
- FULL normalized: `170/180`, invalid `6`, unsafe `1`, critical `4`, mean tokens `404.4`
- SEMANTIC: `169/180`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

FULL means production-shaped `NormalizedEmailDocumentV1`, not raw MIME/base64. Add-back/causality diagnostics showed prompt-shape/token-position sensitivity, so do not add random technical fields based on one row.

## V12 STAGE 0 — CONSTRAINED OUTPUT PASSED DEVELOPMENT GATE

The unchanged V11 adapter was rerun with a decoder that permits only the 18 legal canonical outputs.

Invalid-only probe: 6/6 exact, invalid 0, unsafe 0.

Full 180 confirmation on frozen Input View Holdout v2:
- exact `176/180`
- constrained invalid output `0`
- unsafe promotions `1`
- `changed_from_valid_baseline = 0`
- no training, adapter mutation or fixture mutation

Four semantic errors remain: ORDER_PROCESSING→ORDER_PACKING, REFUNDED→RETURN, PAYMENT→INVOICE, OUT_FOR_DELIVERY→DELIVERED (unsafe).

Treat constrained semantic decoding as the V12 development output baseline. The frozen 180 remains evaluation-only and non-trainable; a new untouched post-V12 holdout is still required.

## V12 STAGE 1 — STUDENT HARD-CASE MINE SCORED

First local run on 144 new synthetic/deidentified cases:
- candidate SHA-256: `05d0ca898b2ccf5f75897d2930a500f960e29b1591a0ec1bb0c8996accae08fa`
- V11 student + constrained decoder: `142/144` exact vs seed
- disagreements: `2`
- unsafe: `0`
- teacher review queue: `14` = 2 disagreements + 12 agreement audits
- `order_processing_vs_packing`: `22/24`; every other pilot family `24/24`

Local run: `local-data/lora-v12/teacher-candidates-v1/runs/20260901T193717Z/`

## V12 STAGE 1B — HUMAN TEACHER REVIEW COMPLETE

Manual in-chat review of the 14 synthetic/deidentified queue rows:
- reviewed `14/14`
- seed labels approved `14/14`
- agreement audits `12/12` student correct
- disagreements `2/2` student wrong, seed correct
- both Qwen errors are `ORDER_PROCESSING -> ORDER_PACKING`
- no external API call and no training

Disagreement IDs: `V12C1-0002` (hu) and `V12C1-0018` (fr). In both, stale/misleading subject says PACKING while current body explicitly says PROCESSING and packing has not started.

Teacher rule: **explicit current body evidence + explicit negation of the next lifecycle step overrides stale/misleading subject or snippet.**

Protocol: `protocols/V12-STAGE1-HUMAN-TEACHER-VERDICT-2026-09-02.md`.

## V12 STAGE 2 — HARD SIBLING CORPUS BUILT AND PASSED GATE

First deterministic local build completed successfully:
- status `V12_HARD_SIBLINGS_V2_CORPUS_READY`
- rows `216`
- TRAIN `144`
- VALIDATION `72`
- languages `hu,en,de,pl,fr,es`
- events `ORDER_PROCESSING,ORDER_PACKING`
- representation variants `6`
- semantic-group train/validation overlap `0`
- frozen/stage1 row reuse `False`
- privacy gate `PASS_SYNTHETIC_DEIDENTIFIED`
- corpus SHA-256 `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`
- training started `False`

Local corpus: `local-data/lora-v12/hard-siblings-v2/` with `cases.jsonl`, `train.sft.jsonl`, `validation.sft.jsonl`, `metrics.json`, and `CORPUS_SHA256.txt`.

This corpus uses new sibling examples, not the two reviewed error rows and not any frozen holdout rows.

## V12 STAGE 2B — PRE-TRAIN V11 BASELINE PREPARED

Before changing any weights, score the unchanged V11 adapter + constrained decoder on the 72 validation-only sibling rows. This establishes the exact pre-training weakness by label and representation variant and keeps the later before/after comparison honest.

Files:
- `scripts/v12-hard-siblings-baseline-v2.py`
- `scripts/run-v12-hard-siblings-baseline-v2.ps1`
- `scripts/BuyFlow-V12-HARD-SIBLINGS-BASELINE.cmd`

The baseline runner verifies the corpus SHA, reads only the 72 `VALIDATION` rows, does not train, does not mutate the corpus, and does not read frozen holdouts.

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the separate test worktree.
2. Run `scripts/BuyFlow-V12-HARD-SIBLINGS-BASELINE.cmd`.
3. Preserve `# SUMMARY`, `# BY_VARIANT`, and `# WRONG_TRANSITIONS` unchanged.
4. Only after the baseline is recorded, build the V12 training merge with V11 replay/retention anchors + the 144 hard-sibling TRAIN rows; do not fine-tune on the two-class corpus alone.
5. Keep the 72 hard-sibling VALIDATION rows out of training.
6. Never train on Fresh Blind v1, Input View Holdout v2, frozen108 or BLIND50.
7. Qwen remains semantic-only; Zero-Trust Purchase Identity Graph remains authoritative.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
