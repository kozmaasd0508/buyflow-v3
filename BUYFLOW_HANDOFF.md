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

- Qwen classifies commerce/lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Frozen evaluation rows remain non-trainable.
- Direct Gmail/source archive/Mailgun source persistence stay OFF by default.
- No raw customer email content or secrets in Git.

## CURRENT V11 EVIDENCE

Completed local Qwen3-8B V11 QLoRA: 5760 TRAIN / 576 validation, 18 labels, multilingual, 1440/1440 optimizer steps, best in-family validation loss about `0.000015`. Protected holdouts were not trained/read.

Fresh Blind v1 first score: exact `163/180`, invalid `7`, unsafe `1`, critical-boundary errors `10`, gate `FAIL`.

Untouched Input View Holdout v2:
- FULL normalized `170/180`, invalid `6`, unsafe `1`, critical `4`
- SEMANTIC `169/180`, invalid `6`, unsafe `2`, critical `5`
- MINIMAL `168/180`, invalid `6`, unsafe `2`, critical `6`

FULL means normalized production-shaped `NormalizedEmailDocumentV1`, not raw MIME/base64.

## V12 STAGE 0 — CONSTRAINED OUTPUT

Unchanged V11 + 18-output constrained decoder:
- invalid-only probe `6/6`
- full frozen 180 `176/180`
- invalid `0`
- unsafe `1`
- changed-from-valid-baseline `0`

Frozen 180 remains diagnostic and non-trainable.

## V12 STAGE 1 — STUDENT MINE + HUMAN TEACHER

144 new synthetic/deidentified hard cases:
- V11 + constrained `142/144`
- unsafe `0`
- only weak family `ORDER_PROCESSING vs ORDER_PACKING` (`22/24`)

Manual review of the 14-row teacher queue:
- seed labels approved `14/14`
- agreement audits `12/12` Qwen correct
- disagreements `2/2` Qwen wrong, seed correct
- both errors `ORDER_PROCESSING -> ORDER_PACKING`

Teacher rule: **explicit current body evidence + explicit negation of the next lifecycle step overrides stale/misleading subject or snippet.**

## V12 STAGE 2 — HARD SIBLINGS

Hard-sibling corpus:
- 216 rows = 144 TRAIN + 72 VALIDATION
- 6 languages / 6 representation variants
- balanced ORDER_PROCESSING / ORDER_PACKING
- semantic-group overlap `0`
- frozen/stage1 row reuse `False`
- privacy PASS
- SHA `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`

Pre-train V11 baseline on 72 validation rows:
- exact `70/72 = 97.22%`
- invalid `0`
- ORDER_PACKING `36/36`
- ORDER_PROCESSING `34/36`
- only wrong transition `ORDER_PROCESSING -> ORDER_PACKING` x2

## V12 STAGE 2C — RETENTION REPLAY PASS

Canonical V11 corpus:
- `local-data/training-v11-normalized-semantic/classification.train.jsonl`
- `local-data/training-v11-normalized-semantic/classification.validation.jsonl`

Retention gate:
- `status: V12_RETENTION_REPLAY_V1_READY`
- replay TRAIN `1152` + hard TRAIN `144` = merged TRAIN `1296`
- replay validation `288` + hard validation `72` = merged validation `360`
- TRAIN ORDER_PROCESSING `136`, ORDER_PACKING `136`, every other event `64`
- validation ORDER_PROCESSING `52`, ORDER_PACKING `52`, every other event `16`
- exact TRAIN/validation overlap `0`
- frozen holdouts read `False`
- TRAIN SHA `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- validation SHA `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`

## V12 STAGE 3 — CONTINUATION TRAINING COMPLETE

Local Qwen3-8B continuation QLoRA completed successfully from the unchanged V11 best adapter.

- console status `V12_TRAINING_COMPLETE`
- persisted metrics status `LORA_V12_RETENTION_ROBUSTNESS_TRAIN_COMPLETE`
- parent V11 adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- parent V11 unchanged `True`
- TRAIN `1296`
- validation `360`
- all 18 labels retained
- epochs `1`
- LR `2e-5`
- grad_accum `4`
- max_seq `768`
- optimizer steps `324/324`
- train loss `0.000222`
- validation loss `0.000007`
- best epoch `1`
- training time `66.36 min`
- GPU peak `10.13 GiB`
- best adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- frozen holdouts read `False`
- adapter saved `True`

Best adapter:
`local-data/lora-v12/runs/20260902T085426Z-qwen3-8b-buyflow-v12-retention-robustness/best`

Protocol:
`protocols/V12-STAGE3-TRAINING-COMPLETE-2026-09-02.md`

Important: the lower validation loss is not enough to claim behavioral improvement.

## V12 STAGE 3B — POST-TRAIN EVALUATOR RESOLVER FIXED

First local post-train evaluation attempt failed before model load with `V12_EXACT_ADAPTER_DISCOVERY:0`.

Cause: the evaluator was checking the console completion label `V12_TRAINING_COMPLETE` against `metrics.json`, while the trainer correctly persists `LORA_V12_RETENTION_ROBUSTNESS_TRAIN_COMPLETE` there.

Fix:
- `scripts/v12-hard-siblings-posttrain-resolved-v2.py`
- `run-v12-hard-siblings-posttrain-v1.ps1` now calls the resolved evaluator
- uses trainer-written `local-data/lora-v12/LATEST.txt`
- verifies exact V12 adapter SHA and metrics SHA
- verifies the persisted metrics status
- verifies recorded V11 parent SHA and re-hashes current V11 parent weights
- rechecks all frozen/holdout/locked-test safety flags and 18-label retention before inference

The failed attempt did not load the model, read frozen holdouts, train, or mutate corpus/model state.

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the separate V11 test worktree.
2. Rerun `scripts/BuyFlow-V12-HARD-SIBLINGS-POSTTRAIN.cmd`.
3. Compare exact result against fixed V11 baseline `70/72`.
4. Do not tune on or read Fresh Blind v1, Input View Holdout v2, frozen108 or BLIND50.
5. After the 72-row before/after result, run a separate all-18-label retention check.
6. Only then build a brand-new untouched post-V12 holdout.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
