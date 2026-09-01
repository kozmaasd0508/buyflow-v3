# BuyFlow worklog latest

## 2026-09-01 — V12 constrained output invalid-only PASS; full-180 gate prepared

Branch: `codex/v12-teacher-robustness-foundation` / PR #302 (draft)

Completed the first V12 Stage 0 constrained-output diagnostic using the unchanged V11 adapter on only the six previously-invalid FULL rows from Input View Holdout v2.

Result:
- selected cases: `6`
- all six expected `ORDER_PROCESSING`
- exact after constrained decoding: `6/6`
- constrained invalid outputs: `0`
- unsafe promotions: `0`
- no training
- no adapter mutation
- no frozen fixture mutation

Local report:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/v12-output-constraint-invalid-v1.json`

Interpretation:
- the malformed V11 generative outputs can be eliminated on these rows structurally without retraining;
- this does not yet justify global adoption because previously-valid rows were not rerun in this first probe.

Prepared the full confirmation gate:
- `scripts/run-v12-output-constraint-full-v1.ps1`
- `scripts/BuyFlow-V12-OUTPUT-CONSTRAINT-FULL.cmd`
- reuses the same runner with `--all` to rerun all 180 FULL holdout rows;
- measures invalid count, unsafe promotions, exact score, and how many previously-valid baseline predictions change.

Next gate: run full 180 constrained decoding. If invalid remains zero with no safety/accuracy regression, use constrained decoding as the V12 output baseline before teacher-student hard-example generation.

---

## 2026-09-01 — V12 teacher + robustness foundation prepared

Started V12 from the completed V11 input-view/causality evidence rather than blindly adding more templates.

Prepared protocol:
`protocols/V12-TEACHER-ROBUSTNESS-FOUNDATION-2026-09-01.md`

V12 plan:
- first eliminate malformed generative output structurally;
- then generate new teacher-reviewed hard-example siblings around actual failure families;
- add representation-invariance augmentation (field order, harmless metadata padding/dropout, equivalent layouts);
- never train on frozen Fresh Blind/Input View Holdout rows;
- use synthetic/deidentified teacher data by default;
- after V12 training, freeze a brand-new untouched holdout before judging gains.

External teacher direction documented but not activated yet: OpenAI Responses API with strict JSON schema, configurable teacher model, environment-only API key, provenance/checkpointing, and no raw customer emails by default.

---

## 2026-09-01 — Input-view causality v1 scored

Branch: `codex/v11-input-view-holdout-v2` / PR #301 (draft)

Causality diagnostic completed on the only FULL-correct / SEMANTIC-wrong holdout case `IVH2-0057` (`IN_TRANSIT` expected, Semantic baseline `OUT_FOR_DELIVERY`).

Result:
- semantic recheck: wrong
- real recipients: correct
- dummy recipients: correct
- neutral padding matched to recipients length: correct
- real headers/auth: correct
- dummy headers/auth: wrong
- neutral padding matched to headers/auth length: correct
- real raw links: correct
- dummy raw links: correct
- neutral padding matched to raw-links length: wrong

Interpretation:
- no single omitted semantic evidence group consistently explains the recovery;
- dummy and neutral prompt additions can recover the same case;
- do not add recipients/auth/raw-links merely because they flipped one row;
- V11 generative classification shows prompt-shape/token-position sensitivity;
- keep FULL normalized input as current baseline;
- the 6 invalid outputs remain a separate output-architecture problem.

Local report:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/input-view-causality-v1.json`

---

## 2026-09-01 — V11 untouched input-view holdout v2 scored

First untouched 180-case score:
- FULL: `170/180 = 94.44%`, invalid `6`, unsafe `1`, critical `4`, mean tokens `404.4`
- SEMANTIC: `169/180 = 93.89%`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180 = 93.33%`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

Frozen SHA: `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`. No training; holdout remains non-trainable.

---

## 2026-09-01 — V11 SemanticEmailView A/B diagnostic scored

On the earlier locked Fresh Blind fixture: FULL `163/180`, SEMANTIC `163/180`; invalid `7 -> 7`; unsafe `1 -> 0`; critical `10 -> 10`; net paired gain `0`.

---

## 2026-08-31 — V11 Fresh Blind v1

First score: exact `163/180 = 90.56%`, commerce `173/180 = 96.11%`, invalid `7`, unsafe `1`, critical `10`, gate `FAIL`. Frozen rows remain non-trainable.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1` / PR #295 (draft). No live provider cutover claimed.

---

## 2026-08-31 — Mobile Architecture Cleanup v1

Branch: `codex/mobile-architecture-cleanup-v1` / PR #297 (draft). Exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286/1286 API tests; browser visual smoke remains pending.
