# BuyFlow worklog latest

## 2026-09-01 — V12 full constrained-output confirmation scored; Stage 1 mining prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

The repaired full-180 constrained run completed on the unchanged V11 adapter and the frozen Input View Holdout v2.

Result:
- selected cases: `180`
- exact: `176/180`
- constrained invalid outputs: `0`
- unsafe promotions: `1`
- changed from previously-valid baseline: `0`
- no training / adapter mutation / fixture mutation

All six previously-invalid ORDER_PROCESSING rows became exact. The four remaining semantic errors were:
- ORDER_PROCESSING -> ORDER_PACKING
- REFUNDED -> RETURN
- PAYMENT -> INVOICE
- OUT_FOR_DELIVERY -> DELIVERED (unsafe)

Interpretation:
- constrained decoding removes malformed output without perturbing any previously-valid baseline prediction on this diagnostic set;
- use constrained semantic decoding as the V12 development output baseline;
- the frozen 180 remains non-trainable and does not replace a fresh post-V12 holdout.

Local report:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/v12-output-constraint-all-v1.json`

Prepared V12 Stage 1 student hard-case mining:
- 144 new synthetic/deidentified candidates;
- 6 boundary families × 6 languages × both labels × 2 representation variants;
- no frozen holdout row copied;
- V11 student runs first with constrained output;
- teacher queue contains every student disagreement plus one agreement audit per family+target label;
- no external teacher API and no training yet.

Files:
- `scripts/v12_hard_candidates_v1.py`
- `scripts/v12-student-mine-candidates-v1.py`
- `scripts/run-v12-student-mine-v1.ps1`
- `scripts/BuyFlow-V12-STUDENT-MINE.cmd`
- `protocols/V12-STAGE1-STUDENT-MINE-V1-2026-09-01.md`

Next: run `BuyFlow-V12-STUDENT-MINE.cmd`, preserve the first summary and family disagreement counts, then teacher-review only the disagreement queue + agreement audit sample.

---

## 2026-09-01 — V12 full constrained launcher WSL-path bug fixed

The first attempt to run the full 180 constrained-output confirmation failed before model inference because WSL received a collapsed Windows path. `run-v12-output-constraint-full-v1.ps1` was corrected to replace ordinary single path separators. No model result was produced by the failed launch.

---

## 2026-09-01 — V12 constrained output invalid-only PASS

Six previously-invalid FULL rows were rerun with constrained output on unchanged V11 weights: `6/6` exact, invalid `0`, unsafe `0`. This established the reason to run the full-180 confirmation.

---

## 2026-09-01 — V12 teacher + robustness foundation prepared

Protocol: `protocols/V12-TEACHER-ROBUSTNESS-FOUNDATION-2026-09-01.md`.

Direction: constrained output first, then new teacher-reviewed hard-example siblings, representation-invariance augmentation, V12 training only on approved new data, and a brand-new untouched holdout after training.

---

## 2026-09-01 — Input-view causality v1 scored

Causality testing on `IVH2-0057` showed dummy/neutral prompt additions could flip the same lifecycle decision. Do not treat recipients/auth/raw-links as useful lifecycle evidence based on one row. Keep FULL normalized input as V11 baseline and train representation robustness separately.

---

## 2026-09-01 — V11 untouched input-view holdout v2 scored

FULL `170/180`, SEMANTIC `169/180`, MINIMAL `168/180`; frozen SHA `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`. No training; holdout remains non-trainable.

---

## 2026-08-31 — Direct Gmail / mobile status

Direct Gmail/OAuth/history/watch/Pub/Sub foundation remains behind disabled-by-default flags with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 / 1286 API tests; browser visual smoke remains pending.
