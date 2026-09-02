# BuyFlow worklog latest

## 2026-09-02 — Retention replay first attempt failed before training; discovery widened

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

First local `BuyFlow-V12-RETENTION-REPLAY.cmd` attempt stopped before any training or corpus mutation:

`V11_CORPUS_DISCOVERY_FAILED: train_matches=0 validation_matches=0`

The diagnostic showed only:
`local-data/lora-v11/runs/20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic/training_config.json -> rows=0 labels=0`

Cause: the replay builder searched only `local-data/lora-v11`, but the original V11 5760/576 corpus is not stored in that narrow run subtree.

Fix committed in `scripts/v12-build-retention-replay-v1.py`:
- corpus discovery now searches safe project data roots: `local-data`, `data`, `training-data`, `artifacts` when present;
- protected paths remain excluded (`fresh-blind`, `input-view`, holdout, frozen108, BLIND50, locked tests, teacher candidates);
- a source is accepted only if it matches the exact original V11 structural signature: TRAIN 5760 with 320/event or validation 576 with 32/event across all 18 labels;
- expanded diagnostics print every inspected candidate if discovery still fails;
- no fallback guessing and no training if unique source files are not proven.

The failed attempt did not load/train the model and did not modify V11/V12 corpora.

Next: pull latest branch and rerun the same retention command. If it still fails, preserve the expanded candidate list so the real original corpus location can be resolved without guessing.

---

## 2026-09-02 — V12 hard-sibling baseline scored; retention replay prepared

The unchanged V11 adapter + constrained decoder was scored on the 72 validation-only rows from hard-siblings-v2.

Result:
- corpus SHA `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`
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

Wrong transitions:
- `ORDER_PROCESSING -> ORDER_PACKING`: `2`

Local metrics:
`local-data/lora-v12/hard-siblings-v2/baseline-v11/runs/20260902T082059Z/metrics.json`

Replay target if discovery succeeds:
- deterministic V11 replay TRAIN: 64/event = 1152;
- deterministic V11 replay validation: 16/event = 288;
- add 144 hard TRAIN + 72 hard validation;
- expected merged TRAIN 1296: processing 136, packing 136, other 16 labels 64 each;
- expected merged validation 360: processing 52, packing 52, other 16 labels 16 each;
- exact train/validation overlap zero;
- no training in the merge step.

---

## 2026-09-02 — V12 hard-sibling corpus gate PASS

Deterministic corpus build: 216 rows = 144 TRAIN + 72 VALIDATION, six languages, six representation variants, balanced ORDER_PROCESSING/ORDER_PACKING, semantic-group overlap 0, frozen/stage1 row reuse false, privacy PASS, SHA `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`.

---

## 2026-09-02 — Human teacher review complete

14 synthetic/deidentified queue rows manually reviewed in-chat: seed labels 14/14 approved, 12/12 agreements correct, 2/2 disagreements were real Qwen errors. Both errors were ORDER_PROCESSING→ORDER_PACKING caused by stale/misleading subject overriding explicit current body evidence.

---

## 2026-09-01 — V12 student hard-case mine scored

144 new hard cases: V11 + constrained `142/144`, disagreements 2, unsafe 0; order_processing_vs_packing `22/24`, all other pilot families `24/24`.

---

## 2026-09-01 — V12 full constrained-output confirmation scored

Frozen diagnostic 180: `176/180`, invalid 0, unsafe 1, changed-from-valid-baseline 0. Frozen rows remain non-trainable.

---

## 2026-09-01 — V11 untouched input-view holdout v2 scored

FULL `170/180`, SEMANTIC `169/180`, MINIMAL `168/180`; no training, holdout remains non-trainable.

---

## 2026-08-31 — Direct Gmail / mobile status

Direct Gmail foundation remains disabled by default with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286 API tests; browser visual smoke remains pending.
