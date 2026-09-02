# BuyFlow worklog latest

## 2026-09-02 — V12 all-18 retention PASS: 288/288 for V11 and V12

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Exact development retention comparison completed on the 288 `V11_REPLAY_VALIDATION` rows only, with constrained output and no training/corpus mutation/protected holdout read.

Result:
- V11 `288/288 = 100.00%`
- V12 `288/288 = 100.00%`
- delta exact `+0`
- invalid V11 `0`
- invalid V12 `0`
- all 18 labels: V11 `16/16`, V12 `16/16`
- V11 wrong transitions: none
- V12 wrong transitions: none
- V11 adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- V12 adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- development validation SHA `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`
- elapsed `22.25 min`

Local metrics:
`local-data/lora-v12/retention-replay-v1/retention-compare/runs/20260902T103814Z/metrics.json`

Interpretation: clean retention PASS. No measurable forgetting appeared across any of the 18 labels on this development retention set. Because both V11 and V12 are perfect here, this is not broad improvement evidence.

The earlier fixed hard-sibling development comparison remains:
- V11 `70/72`
- V12 `71/72`
- ORDER_PROCESSING `34/36 -> 36/36`
- ORDER_PACKING `36/36 -> 35/36`
- one V12 stale-snippet reverse error `ORDER_PACKING -> ORDER_PROCESSING`.

Protocol:
`protocols/V12-STAGE3C-ALL18-RETENTION-RESULT-2026-09-02.md`

Next: do not tune again on these development sets. Build a brand-new SHA-locked post-V12 untouched holdout with entirely new rows/wording/representation families across all 18 labels, then compare unchanged V11 vs exact V12 once. After the V12 final gate is closed, begin the full BuyFlow module-by-module audit.

---

## 2026-09-02 — V12 hard-sibling post-train: 71/72

Exact V12 post-training evaluation on the same fixed 72 hard-sibling validation rows:
- V11 baseline `70/72 = 97.22%`
- V12 `71/72 = 98.61%`
- delta `+1`
- invalid `0`
- ORDER_PROCESSING `34/36 -> 36/36`
- ORDER_PACKING `36/36 -> 35/36`
- only V12 wrong transition `ORDER_PACKING -> ORDER_PROCESSING` x1 on `stale_snippet`.

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

## 2026-09-01 — Constrained-output baseline

Frozen diagnostic 180 with unchanged V11 + constrained output: `176/180`, invalid 0, unsafe 1. Frozen rows remain non-trainable.

---

## 2026-08-31 — Direct Gmail / mobile status

Direct Gmail foundation remains disabled by default with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286 API tests; browser visual smoke remains pending.
