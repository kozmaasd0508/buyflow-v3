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
- misleading_subject `11/12`
- metadata_order_shift `11/12`
- every other representation variant `12/12`

## V12 STAGE 2C — RETENTION REPLAY PASS

Canonical V11 corpus located directly at:
- `local-data/training-v11-normalized-semantic/classification.train.jsonl`
- `local-data/training-v11-normalized-semantic/classification.validation.jsonl`

Local gate result:
- `v11_corpus_signature: PASS_18_EVENTS_BALANCED`
- `status: V12_RETENTION_REPLAY_V1_READY`
- replay TRAIN `1152`
- hard TRAIN `144`
- merged TRAIN `1296`
- replay validation `288`
- hard validation `72`
- merged validation `360`
- TRAIN ORDER_PROCESSING `136`, ORDER_PACKING `136`, every other event `64`
- validation ORDER_PROCESSING `52`, ORDER_PACKING `52`, every other event `16`
- exact TRAIN/validation overlap `0`
- frozen holdouts read `False`
- TRAIN SHA `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- validation SHA `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`
- training started `False`

The earlier recursive discovery attempts failed or were interrupted before training and caused no model/corpus mutation.

## V12 STAGE 3 — CONTINUATION TRAINING PREPARED

Prepared:
- `scripts/train-v12-retention-qwen-v1.py`
- `scripts/run-v12-retention-train-v1.ps1`
- `scripts/BuyFlow-V12-RETENTION-TRAIN.cmd`
- `protocols/V12-STAGE3-RETENTION-CONTINUATION-TRAIN-V1-2026-09-02.md`

Training contract:
- start from exact V11 best adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- never overwrite V11; save separate V12 child adapter under `local-data/lora-v12/runs/...`
- verify exact merged TRAIN/validation hashes before loading model
- 1296 TRAIN / 360 validation
- retain all 18 labels
- one conservative first epoch
- LR `2e-5`
- grad_accum `4`
- max_seq `768`
- Qwen3-8B NF4
- no Fresh Blind / Input View Holdout / frozen108 / BLIND50 / locked test read or training

## NEXT ACTION

1. Pull latest `codex/v12-teacher-robustness-foundation` in the separate V11 test worktree.
2. Run `scripts/BuyFlow-V12-RETENTION-TRAIN.cmd`.
3. Preserve the opening V12 training gate and final `[6/6]` verification block.
4. Do not claim V12 improvement from validation loss alone.
5. After successful training, score the V12 best child adapter with constrained decoding on the 72 hard-sibling validation set, then run a separate all-18-label retention check, then create a brand-new untouched post-V12 holdout.
6. Protected old holdouts remain frozen during tuning.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
