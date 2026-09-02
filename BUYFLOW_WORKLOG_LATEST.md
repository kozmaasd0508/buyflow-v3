# BuyFlow worklog latest

## 2026-09-02 — V12 continuation QLoRA COMPLETE; post-train exact evaluator prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Local Stage 3 continuation training completed successfully:
- status `V12_TRAINING_COMPLETE`
- model `Qwen/Qwen3-8B`
- GPU `AMD Radeon RX 9060 XT`
- parent V11 adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- parent V11 unchanged `True`
- merged TRAIN SHA `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- merged validation SHA `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`
- TRAIN `1296`
- validation `360`
- all 18 events retained
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
- adapter saved `True`
- frozen holdouts read `False`
- frozen108 trained `False`
- BLIND50 trained `False`

Best adapter:
`local-data/lora-v12/runs/20260902T085426Z-qwen3-8b-buyflow-v12-retention-robustness/best`

Training itself PASS. Validation loss is not treated as proof of behavioral improvement.

Prepared the exact post-training before/after gate:
- `scripts/v12-hard-siblings-posttrain-v1.py`
- `scripts/run-v12-hard-siblings-posttrain-v1.ps1`
- `scripts/BuyFlow-V12-HARD-SIBLINGS-POSTTRAIN.cmd`

The evaluator:
- requires exact V12 best adapter SHA `5addcbce...f630`;
- uses the same fixed 72 hard-sibling validation rows and exact corpus SHA;
- uses constrained output;
- does not train or mutate the corpus;
- does not read frozen holdouts;
- reports delta against the fixed V11 baseline `70/72`.

Next: run `scripts/BuyFlow-V12-HARD-SIBLINGS-POSTTRAIN.cmd`. Only after this exact score should we claim whether the target ORDER_PROCESSING/ORDER_PACKING boundary improved. Then run a separate all-18-label retention check before a brand-new untouched V12 holdout.

---

## 2026-09-02 — V12 retention replay PASS

Canonical V11 corpus signature passed. Built merged retention corpus: 1152 V11 replay + 144 hard TRAIN = 1296; 288 V11 replay + 72 hard validation = 360; all 18 labels retained; exact overlap 0; frozen holdouts read False.

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
