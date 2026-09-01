# BuyFlow worklog latest

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
- therefore recipients/auth/raw-links must not be added to SemanticEmailViewV2 merely because they flipped this row;
- V11 generative classification shows prompt-shape/token-position sensitivity at this lifecycle boundary;
- keep FULL normalized input as current baseline while treating compact-view design as a separate robustness optimization;
- the 6 invalid outputs from the untouched 180-case holdout remain a separate output-architecture problem.

Local report:
`local-data/lora-v11/input-view-holdout-v2/runs/20260901T183055Z/input-view-causality-v1.json`

Next:
1. address malformed generative output via constrained/structured decoding or a sequence-classification head;
2. design V12 teacher-student/hard-example training using new sibling examples, not frozen rows;
3. include representation-invariance augmentation: harmless metadata padding/dropout, field-order/layout changes and equivalent compact/full views;
4. freeze a new untouched holdout after V12;
5. keep BLIND50/frozen108 untouched for tuning.

---

## 2026-09-01 — Input-view add-back scored; causality diagnostic prepared

Local add-back v1 completed on the only FULL-correct / SEMANTIC-wrong holdout case:
- `IVH2-0057`
- expected `IN_TRANSIT`
- Semantic predicted `OUT_FOR_DELIVERY`
- raw_html: `0/1` recovered, +6 tokens
- recipients: `1/1`, +23
- headers_auth: `1/1`, +51
- provider_meta: `0/1`, +33
- raw_links: `1/1`, +37
- raw_attachments: `0/1`, +4
- pipeline_meta: `0/1`, +36
- all: `1/1`, +190

Because semantically unrelated groups independently flipped the row, a causality diagnostic was added instead of treating those fields as lifecycle evidence.

---

## 2026-09-01 — V11 untouched input-view holdout v2 scored

First untouched 180-case score:
- FULL: `170/180 = 94.44%`, invalid `6`, unsafe `1`, critical `4`, mean tokens `404.4`
- SEMANTIC: `169/180 = 93.89%`, invalid `6`, unsafe `2`, critical `5`, mean tokens `259.2`
- MINIMAL: `168/180 = 93.33%`, invalid `6`, unsafe `2`, critical `6`, mean tokens `178.2`

Frozen SHA: `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`. No training; holdout remains non-trainable.

---

## 2026-09-01 — V11 SemanticEmailView A/B diagnostic scored

On the earlier locked Fresh Blind fixture: FULL `163/180`, SEMANTIC `163/180`; invalid `7 -> 7`; unsafe `1 -> 0`; critical `10 -> 10`; net paired gain `0`. Useful signal but not enough to choose representation.

---

## 2026-08-31 — V11 Fresh Blind v1

First score: exact `163/180 = 90.56%`, commerce `173/180 = 96.11%`, invalid `7`, unsafe `1`, critical `10`, gate `FAIL`. Frozen rows remain non-trainable.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1` / PR #295 (draft). Direct Gmail/OAuth/history/watch/Pub/Sub/read-only shadow foundation implemented behind disabled-by-default flags; no live provider cutover claimed.

---

## 2026-08-31 — Mobile Architecture Cleanup v1

Branch: `codex/mobile-architecture-cleanup-v1` / PR #297 (draft). Exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` passed CI #1139 including 1286/1286 API tests; browser visual smoke remains pending.
