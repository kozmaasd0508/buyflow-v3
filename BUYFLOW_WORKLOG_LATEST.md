# BuyFlow worklog latest

## 2026-09-01 — V12 student hard-case mine scored; independent Sol teacher review prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Completed the first V12 Stage 1 student mine on 144 new synthetic/deidentified hard-boundary cases using the unchanged V11 adapter plus constrained output.

Result:
- candidate SHA-256: `05d0ca898b2ccf5f75897d2930a500f960e29b1591a0ec1bb0c8996accae08fa`
- student exact vs seed: `142/144`
- disagreements: `2`
- unsafe: `0`
- teacher queue: `14` = 2 disagreements + 12 agreement audits
- `order_processing_vs_packing`: `22/24`, 2 disagreements
- every other pilot family: `24/24`
- no teacher API call and no training in this run

Local run:
`local-data/lora-v12/teacher-candidates-v1/runs/20260901T193717Z/`

Prepared the next independent teacher gate:
- `scripts/v12-teacher-review-openai-v1.py`
- `scripts/run-v12-teacher-review-openai-v1.ps1`
- `scripts/BuyFlow-V12-TEACHER-REVIEW.cmd`
- `protocols/V12-STAGE1-OPENAI-TEACHER-REVIEW-V1-2026-09-01.md`

Teacher contract:
- default `gpt-5.6-sol` through Responses API;
- strict JSON-schema output;
- teacher receives only case id, boundary family, language hint and synthetic/deidentified document;
- seed expected label and Qwen prediction are deliberately hidden from the teacher until after independent classification;
- `store=false`;
- `OPENAI_API_KEY` environment-only, never persisted;
- checkpoint/resume per case;
- only seed-match + evidence sufficient + HIGH confidence is approved for later augmentation;
- even approved rows remain `train_eligible=false` until the later corpus-build stage.

Next: run the 14-case teacher review, preserve first summary and inspect any teacher-vs-seed conflict before creating representation-invariance siblings or V12 training data.

---

## 2026-09-01 — V12 full constrained-output confirmation scored

Full 180 constrained run on unchanged V11 adapter: `176/180` exact, invalid `0`, unsafe `1`, changed-from-valid-baseline `0`. All six formerly-invalid ORDER_PROCESSING rows became exact. Four real semantic errors remained. Frozen holdout remains non-trainable.

---

## 2026-09-01 — V12 constrained output invalid-only PASS

Six previously-invalid FULL rows were rerun with constrained output on unchanged V11 weights: `6/6` exact, invalid `0`, unsafe `0`.

---

## 2026-09-01 — V12 teacher + robustness foundation prepared

Direction: constrained output first, then new teacher-reviewed hard-example siblings, representation-invariance augmentation, V12 training only on approved new data, and a brand-new untouched holdout after training.

---

## 2026-09-01 — Input-view causality v1 scored

Causality testing showed dummy/neutral prompt additions could flip the same lifecycle decision. Do not treat random technical fields as lifecycle evidence based on one row. Keep FULL normalized input as V11 baseline and train representation robustness separately.

---

## 2026-09-01 — V11 untouched input-view holdout v2 scored

FULL `170/180`, SEMANTIC `169/180`, MINIMAL `168/180`; frozen SHA `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`. No training; holdout remains non-trainable.

---

## 2026-08-31 — Direct Gmail / mobile status

Direct Gmail/OAuth/history/watch/Pub/Sub foundation remains behind disabled-by-default flags with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 / 1286 API tests; browser visual smoke remains pending.
