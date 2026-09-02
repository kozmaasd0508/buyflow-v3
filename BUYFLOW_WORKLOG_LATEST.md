# BuyFlow worklog latest

## 2026-09-02 — V12 Stage 4 holdout FROZEN; one-shot compare prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

The brand-new post-training holdout was frozen locally before any model scoring:
- status `V12_POSTTRAIN_HOLDOUT_V1_FROZEN`
- SHA `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- rows `108`
- 18 events x 6 rows
- languages `hu,en,de,pl,fr,es`
- variants `clean_plain`, `stale_subject`, `html_only`, `stale_snippet`, `quoted_history`, `metadata_noise`
- event x language matrix complete
- event x variant matrix complete
- synthetic/deidentified `True`
- source rows copied `False`
- training/tuning eligible `False`
- model loaded at freeze `False`
- V11 scored `False`
- V12 scored `False`
- protected holdouts read `False`
- prior training corpus read `False`
- prior hard-sibling rows read `False`

Prepared after the freeze:
- `scripts/v12-posttrain-holdout-compare-v1.py`
- `scripts/run-v12-posttrain-holdout-compare-v1.ps1`
- `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-COMPARE.cmd`
- protocol `protocols/V12-STAGE4-HOLDOUT-FROZEN-AND-COMPARE-PREP-2026-09-02.md`

The compare is one-shot, requires the exact frozen holdout SHA and exact V11/V12 adapter SHAs, scores both models with constrained decoding, hides per-case results until both complete, performs no training/corpus mutation, and refuses a second completed run if `FINAL_RESULT.json` already exists.

Next: run `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-COMPARE.cmd` once and inspect overall, per-event, per-language, per-variant, invalid and wrong-transition results. Never tune from this holdout.

---

## 2026-09-02 — V12 post-training untouched holdout v1 prepared

After the clean all-18 retention PASS, prepared the final post-training freeze gate without scoring any model:
- `scripts/v12-posttrain-holdout-v1.py`
- `scripts/run-v12-posttrain-holdout-v1.ps1`
- `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-V1.cmd`
- `protocols/V12-STAGE4-POSTTRAIN-UNTOUCHED-HOLDOUT-V1-2026-09-02.md`

Holdout design:
- 108 brand-new synthetic/deidentified cases
- 18 events x 6 rows
- languages `hu,en,de,pl,fr,es`
- variants `clean_plain`, `stale_subject`, `html_only`, `stale_snippet`, `quoted_history`, `metadata_noise`
- complete event x language and event x variant matrices
- newly authored wording; no source row copying
- train/tuning eligible `False`
- no model load
- no V11/V12 training corpus read
- no hard-sibling row read
- no Fresh Blind / Input View Holdout / frozen108 / BLIND50 read

The generator writes locally to `local-data/lora-v12/posttrain-holdout-v1/` and SHA-locks `cases.jsonl`. If a frozen copy already exists, any byte/SHA mismatch fails closed.

---

## 2026-09-02 — V12 all-18 retention PASS: 288/288 for V11 and V12

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
