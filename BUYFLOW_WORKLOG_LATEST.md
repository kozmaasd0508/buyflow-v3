# BuyFlow worklog latest

## 2026-09-02 — V12 hard-sibling post-train: 71/72; all-18 retention compare prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Exact V12 post-training evaluation completed on the same fixed 72 hard-sibling validation rows with constrained output:
- V11 baseline `70/72 = 97.22%`
- V12 `71/72 = 98.61%`
- delta `+1`
- invalid `0`
- wrong `1`
- ORDER_PROCESSING `34/36 -> 36/36`
- ORDER_PACKING `36/36 -> 35/36`
- clean_plain `12/12`
- html_body `12/12`
- metadata_order_shift `12/12`
- misleading_subject `12/12`
- quoted_old_state `12/12`
- stale_snippet `11/12`
- only V12 wrong transition: `ORDER_PACKING -> ORDER_PROCESSING` x1
- V12 adapter SHA verified `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- parent V11 SHA verified `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- training `False`
- corpus mutation `False`
- frozen holdouts read `False`

Local metrics:
`local-data/lora-v12/hard-siblings-v2/posttrain-v12/runs/20260902T101119Z/metrics.json`

Interpretation: V12 fixes both previously observed ORDER_PROCESSING->ORDER_PACKING hard-sibling errors but introduces one reverse stale-snippet error. Net exact improvement is +1 on this development set; this is not broad proof and not a reason to tune again yet.

Prepared next gate:
- `scripts/v12-retention-compare-v1.py`
- `scripts/run-v12-retention-compare-v1.ps1`
- `scripts/BuyFlow-V12-RETENTION-COMPARE.cmd`

The new gate compares exact unchanged V11 vs V12 on the 288 `V11_REPLAY_VALIDATION` rows only: 18 labels x 16 rows, constrained output, exact adapter/hash/safety checks, no training, no corpus mutation, and no protected holdout read. This is development retention evidence, not a new untouched holdout.

Next: run `scripts/BuyFlow-V12-RETENTION-COMPARE.cmd`, inspect overall + per-label deltas and wrong transitions, then only if retention is acceptable create a brand-new untouched V12 post-training holdout.

---

## 2026-09-02 — V12 post-train evaluator first attempt failed before model load; resolver fixed

First local post-train evaluation attempt failed before model loading/inference with `V12_EXACT_ADAPTER_DISCOVERY:0` because the evaluator checked the human-facing console completion label instead of the persisted metrics status. The resolver was fixed to use `LATEST.txt`, exact adapter SHA, persisted status and parent SHA. No model/corpus/holdout mutation occurred.

---

## 2026-09-02 — V12 continuation QLoRA COMPLETE

Local Stage 3 continuation training completed successfully:
- Qwen3-8B / AMD Radeon RX 9060 XT
- parent V11 unchanged
- TRAIN 1296 / validation 360
- 324/324 optimizer steps
- LR `2e-5`, 1 epoch, grad_accum 4, max_seq 768
- train loss `0.000222`, validation loss `0.000007`
- best adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- frozen holdouts read `False`

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
