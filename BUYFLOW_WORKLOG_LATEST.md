# BuyFlow worklog latest

## 2026-09-02 — V12 hard-sibling baseline scored; retention replay prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

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

Interpretation: the validation split reproduces the exact human-confirmed weak boundary. There is only a two-case headroom on this development set, so training must be conservative and must protect the other 16 lifecycle labels.

Prepared retention/replay merge gate rather than training on the two-class hard corpus alone:
- `scripts/v12-build-retention-replay-v1.py`
- `scripts/run-v12-retention-replay-v1.ps1`
- `scripts/BuyFlow-V12-RETENTION-REPLAY.cmd`
- `protocols/V12-STAGE2-RETENTION-REPLAY-V1-2026-09-02.md`

Replay contract:
- locate only original V11 TRAIN 5760 (320/event) and validation 576 (32/event);
- protected/frozen path families are excluded from corpus discovery;
- deterministic V11 replay TRAIN: 64/event = 1152;
- deterministic V11 replay validation: 16/event = 288;
- add 144 hard TRAIN + 72 hard validation;
- expected merged TRAIN 1296: processing 136, packing 136, other 16 labels 64 each;
- expected merged validation 360: processing 52, packing 52, other 16 labels 16 each;
- exact train/validation overlap must be zero;
- record original-source and merged-file hashes;
- no training in this step.

Next: run `BuyFlow-V12-RETENTION-REPLAY.cmd`. Only after a clean `V12_RETENTION_REPLAY_V1_READY` result should a separate V12 child-adapter continuation run be prepared from V11.

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
