# BuyFlow worklog latest

## 2026-09-01 — Input-view add-back scored; causality diagnostic prepared

Branch: `codex/v11-input-view-holdout-v2` / PR #301 (draft)

Local add-back v1 completed on the only FULL-correct / SEMANTIC-wrong holdout case:
- case `IVH2-0057`
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

Interpretation caution:
- recipients, authentication headers and raw links are semantically unrelated as direct evidence for `IN_TRANSIT` versus `OUT_FOR_DELIVERY`, yet all three independently flip the single case to correct;
- therefore the add-back result does not justify adding those fields to the compact view;
- likely alternative explanation is prompt-shape/token-position sensitivity of the V11 generative classifier.

Prepared `Input View Causality v1` to distinguish evidence from formatting sensitivity. It compares, on the same already-used candidate case:
- real recipients / headers-auth / raw-links;
- dummy versions with neutral values but similar structure;
- neutral padding targeted to similar prompt lengths;
- semantic baseline recheck.

Files:
- `scripts/v11-input-view-causality-v1.py`
- `scripts/run-v11-input-view-causality-v1.ps1`
- `scripts/BuyFlow-V11-INPUT-VIEW-CAUSALITY.cmd`

Safety: diagnostic only, no training, no fixture mutation, frozen rows remain non-trainable.

Next: run causality diagnostic. If dummy/neutral variants also recover the case, classify the add-back effect as representation sensitivity rather than useful lifecycle evidence.

---

## 2026-09-01 — Input-view add-back diagnostic prepared

After the untouched input-view holdout showed FULL > SEMANTIC > MINIMAL on accuracy/safety, added a diagnostic-only field add-back experiment over FULL-correct / SEMANTIC-wrong rows. No training or fixture mutation.

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
