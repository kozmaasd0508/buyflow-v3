# BuyFlow worklog latest

## 2026-09-02 — V12 hard-sibling corpus gate PASS; pre-train V11 baseline prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

The first deterministic hard-sibling/representation-robustness corpus build completed locally after the manual human-teacher verdict.

Result:
- status `V12_HARD_SIBLINGS_V2_CORPUS_READY`
- rows `216`
- TRAIN `144`
- VALIDATION `72`
- languages `hu,en,de,pl,fr,es`
- events `ORDER_PROCESSING,ORDER_PACKING`
- representation variants `6`
- semantic-group split overlap `0`
- frozen/stage1 row reuse `False`
- privacy gate `PASS_SYNTHETIC_DEIDENTIFIED`
- SHA-256 `f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`
- training started `False`

Local corpus:
`local-data/lora-v12/hard-siblings-v2/`

The generator produced new sibling rows only; it does not copy `V12C1-0002`, `V12C1-0018`, any Input View Holdout row, Fresh Blind row, frozen108, or BLIND50.

Before changing weights, prepared a pre-train V11 baseline on only the 72 sibling VALIDATION rows:
- `scripts/v12-hard-siblings-baseline-v2.py`
- `scripts/run-v12-hard-siblings-baseline-v2.ps1`
- `scripts/BuyFlow-V12-HARD-SIBLINGS-BASELINE.cmd`

The runner verifies the corpus SHA, uses unchanged V11 + constrained output, records accuracy by label/language/representation variant and wrong transitions, does not train, does not mutate the corpus, and does not read frozen holdouts.

Next: run the 72-case baseline and preserve the first result. Then construct the V12 training merge with V11 replay/retention anchors plus the 144 new hard-sibling TRAIN rows. Do not fine-tune on the two-class hard corpus alone because retention of the other 16 lifecycle classes must be protected.

---

## 2026-09-02 — Human teacher review complete; V12 hard-sibling corpus prepared

The 14-row Stage 1 synthetic/deidentified teacher queue was reviewed manually in-chat rather than through an external API.

Verdict:
- reviewed `14/14`
- seed labels approved `14/14`
- agreement audits `12/12` student correct
- disagreements `2/2` student wrong, seed correct
- no external teacher API call
- no training

Confirmed student errors:
- `V12C1-0002`: expected ORDER_PROCESSING, student ORDER_PACKING
- `V12C1-0018`: expected ORDER_PROCESSING, student ORDER_PACKING

Both share the same failure: stale/misleading subject claims packing while the current body explicitly says processing and that packing has not started.

Recorded protocol: `protocols/V12-STAGE1-HUMAN-TEACHER-VERDICT-2026-09-02.md`.

---

## 2026-09-01 — V12 student hard-case mine scored

First V12 Stage 1 mine on 144 new synthetic/deidentified cases with unchanged V11 + constrained output:
- exact `142/144`
- disagreements `2`
- unsafe `0`
- teacher queue `14`
- `order_processing_vs_packing` `22/24`
- all other pilot families `24/24`

Local run: `local-data/lora-v12/teacher-candidates-v1/runs/20260901T193717Z/`.

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

Direct Gmail/OAuth/history/watch/Pub/Sub foundation remains behind disabled-by-default flags with no live provider cutover. Mobile cleanup code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286 API tests; browser visual smoke remains pending.
