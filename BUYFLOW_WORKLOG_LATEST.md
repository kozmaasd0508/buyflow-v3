# BuyFlow worklog latest

## 2026-09-02 — Human teacher review complete; V12 hard-sibling corpus prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

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

Both have the same underlying failure: stale/misleading subject claims packing, while the current body explicitly says processing and explicitly says packing has not started. This occurred in Hungarian and French, indicating a general evidence-priority problem rather than one-language wording noise.

Recorded protocol:
`protocols/V12-STAGE1-HUMAN-TEACHER-VERDICT-2026-09-02.md`

Prepared Stage 2 corpus generator instead of copying the two error rows:
- `scripts/v12-hard-siblings-v2.py`
- `scripts/run-v12-hard-siblings-v2.ps1`
- `scripts/BuyFlow-V12-HARD-SIBLINGS-V2.cmd`

Planned first corpus gate:
- 216 new synthetic/deidentified rows
- 144 TRAIN candidates / 72 VALIDATION
- hu/en/de/pl/fr/es
- ORDER_PROCESSING and ORDER_PACKING balanced
- validation separated by wording family, not just row hash
- six representation variants: clean, misleading subject, HTML body, stale snippet, quoted old state, metadata/order shift
- no `IVH2-` / `V12C1-` / old candidate row reuse
- no frozen fixture hash reuse
- semantic-group train/validation overlap must be zero
- no training in this step

Next: run `BuyFlow-V12-HARD-SIBLINGS-V2.cmd`, preserve corpus SHA and validation summary, then build the V12 training merge only if corpus gate passes.

---

## 2026-09-01 — V12 student hard-case mine scored

First V12 Stage 1 mine on 144 new synthetic/deidentified cases with unchanged V11 + constrained output:
- exact `142/144`
- disagreements `2`
- unsafe `0`
- teacher queue `14`
- `order_processing_vs_packing` `22/24`
- all other pilot families `24/24`

Local run:
`local-data/lora-v12/teacher-candidates-v1/runs/20260901T193717Z/`

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
