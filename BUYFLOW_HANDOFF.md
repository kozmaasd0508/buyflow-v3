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

Unchanged V11 adapter + decoder restricted to the 18 legal outputs:
- invalid-only probe: `6/6` exact, invalid `0`, unsafe `0`
- full frozen 180: `176/180`, invalid `0`, unsafe `1`, changed-from-valid-baseline `0`

Four semantic errors remain on that diagnostic set: ORDER_PROCESSING→ORDER_PACKING, REFUNDED→RETURN, PAYMENT→INVOICE, OUT_FOR_DELIVERY→DELIVERED (unsafe).

Treat constrained semantic decoding as the V12 development output baseline. Frozen 180 remains evaluation-only and non-trainable.

## V12 STAGE 1 — STUDENT MINE + HUMAN TEACHER COMPLETE

144 new synthetic/deidentified hard cases:
- V11 + constrained: `142/144`
- disagreements: `2`
- unsafe: `0`
- `order_processing_vs_packing`: `22/24`; every other pilot family `24/24`

Manual in-chat review of the 14-row teacher queue:
- seed labels approved `14/14`
- agreement audits `12/12` Qwen correct
- disagreements `2/2` Qwen wrong, seed correct
- both errors: `ORDER_PROCESSING -> ORDER_PACKING`
- IDs: `V12C1-0002` (hu), `V12C1-0018` (fr)

Teacher rule: **explicit current body evidence + explicit negation of the next lifecycle step overrides stale/misleading subject or snippet.**

Protocol: `protocols/V12-STAGE1-HUMAN-TEACHER-VERDICT-2026-09-02.md`.

## V12 STAGE 2 — HARD SIBLING CORPUS PASS

Built new corpus:
- status `V12_HARD_SIBLINGS_V2_CORPUS_READY`
- rows `216`
- TRAIN `144`
- VALIDATION `72`
- hu/en/de/pl/fr/es
- balanced ORDER_PROCESSING / ORDER_PACKING
- six representation variants
- semantic-group train/validation overlap `0`
- frozen/stage1 row reuse `False`
- privacy gate `PASS_SYNTHETIC_DEIDENTIFIED`
- SHA-256 `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`

Local corpus: `local-data/lora-v12/hard-siblings-v2/`.

## V12 STAGE 2B — PRE-TRAIN V11 BASELINE SCORED

Unchanged V11 + constrained decoder on the 72 validation-only hard siblings:
- exact `70/72 = 97.22%`
- invalid `0`
- wrong `2`
- ORDER_PACKING `36/36`
- ORDER_PROCESSING `34/36`

By representation:
- clean_plain `12/12`
- html_body `12/12`
- metadata_order_shift `11/12`
- misleading_subject `11/12`
- quoted_old_state `12/12`
- stale_snippet `12/12`

Wrong transition:
- `ORDER_PROCESSING -> ORDER_PACKING`: `2`

Local metrics:
`local-data/lora-v12/hard-siblings-v2/baseline-v11/runs/20260902T082059Z/metrics.json`

Interpretation: the validation set reproduces the exact confirmed weak boundary and leaves only two errors, so it is suitable as a before/after development metric. It is not a production holdout.

## V12 STAGE 2C — RETENTION REPLAY MERGE PREPARED

Do **not** train on the 144 two-class hard rows alone. Preserve the other 16 lifecycle classes with deterministic V11 replay anchors.

Prepared:
- `scripts/v12-build-retention-replay-v1.py`
- `scripts/run-v12-retention-replay-v1.ps1`
- `scripts/BuyFlow-V12-RETENTION-REPLAY.cmd`
- `protocols/V12-STAGE2-RETENTION-REPLAY-V1-2026-09-02.md`

Builder contract:
- discover only the original V11 synthetic TRAIN (`5760`, 320/event) and validation (`576`, 32/event) corpora;
- explicitly exclude Fresh Blind/Input View Holdout/frozen/BLIND50 path families from discovery;
- replay TRAIN: `64/event = 1152` rows;
- replay validation: `16/event = 288` rows;
- add hard TRAIN `144` and hard validation `72`;
- expected merged TRAIN `1296`: ORDER_PROCESSING `136`, ORDER_PACKING `136`, every other event `64`;
- expected merged validation `360`: ORDER_PROCESSING `52`, ORDER_PACKING `52`, every other event `16`;
- exact TRAIN/validation overlap must be `0`;
- record source and merged hashes;
- no training in this gate.

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the separate test worktree.
2. Run `scripts/BuyFlow-V12-RETENTION-REPLAY.cmd`.
3. Preserve the full `# BUYFLOW V12 RETENTION REPLAY V1` block and hashes.
4. Only if status is `V12_RETENTION_REPLAY_V1_READY` with expected counts, prepare V12 continuation training from the unchanged V11 adapter as a separate child run.
5. Keep hard-sibling VALIDATION rows out of training.
6. Never train on Fresh Blind v1, Input View Holdout v2, frozen108 or BLIND50.
7. Qwen remains semantic-only; Zero-Trust Purchase Identity Graph remains authoritative.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
