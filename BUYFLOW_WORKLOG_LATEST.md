# BuyFlow worklog latest

## 2026-09-02 — V12 retention replay PASS; continuation training prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

The direct canonical V11 corpus resolver succeeded locally:
- V11 corpus root: `local-data/training-v11-normalized-semantic`
- train rows `5760`
- validation rows `576`
- signature `PASS_18_EVENTS_BALANCED`

Retention merge result:
- status `V12_RETENTION_REPLAY_V1_READY`
- replay TRAIN `1152`
- hard TRAIN `144`
- merged TRAIN `1296`
- replay validation `288`
- hard validation `72`
- merged validation `360`
- TRAIN ORDER_PROCESSING `136`
- TRAIN ORDER_PACKING `136`
- every other TRAIN event `64`
- validation ORDER_PROCESSING `52`
- validation ORDER_PACKING `52`
- every other validation event `16`
- exact TRAIN/validation overlap `0`
- frozen holdouts read `False`
- merged TRAIN SHA `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- merged validation SHA `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`
- training started `False`

The prior recursive discovery failures/interruption happened before model loading/training and did not mutate V11 or V12 weights.

Prepared Stage 3 continuation trainer:
- `scripts/train-v12-retention-qwen-v1.py`
- `scripts/run-v12-retention-train-v1.ps1`
- `scripts/BuyFlow-V12-RETENTION-TRAIN.cmd`
- `protocols/V12-STAGE3-RETENTION-CONTINUATION-TRAIN-V1-2026-09-02.md`

Trainer safety:
- requires exact merged TRAIN/validation hashes above;
- requires exact parent V11 best adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`;
- loads V11 best adapter as trainable parent but saves a distinct V12 child run under `local-data/lora-v12/runs/...`;
- verifies all 18 labels and exact class counts before training;
- one conservative epoch, LR `2e-5`, grad_accum `4`, max_seq `768`, Qwen3-8B NF4;
- no Fresh Blind/Input View Holdout/frozen108/BLIND50/locked-test read or training.

Next: pull latest branch and run `scripts/BuyFlow-V12-RETENTION-TRAIN.cmd`. This next command **does perform real QLoRA training**. After successful save, evaluate exact behavior with constrained decoding; validation loss alone is not enough to claim improvement.

---

## 2026-09-02 — V12 hard-sibling baseline

Unchanged V11 + constrained decoder on 72 hard-sibling validation rows: `70/72 = 97.22%`, invalid 0. ORDER_PACKING 36/36, ORDER_PROCESSING 34/36; only wrong transition ORDER_PROCESSING→ORDER_PACKING x2.

---

## 2026-09-02 — Human teacher + hard siblings

14-row human teacher review approved all seed labels; both student disagreements were true ORDER_PROCESSING→ORDER_PACKING errors. Built 216 new synthetic/deidentified hard siblings: 144 TRAIN + 72 validation, six languages, six representation variants, no frozen/stage1 row reuse.

---

## 2026-09-01 — Constrained-output baseline

Frozen diagnostic 180 with unchanged V11 + constrained output: `176/180`, invalid 0, unsafe 1. Frozen rows remain non-trainable.

---

## 2026-08-31 — Direct Gmail / mobile status

Direct Gmail foundation remains disabled by default with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286 API tests; browser visual smoke remains pending.
