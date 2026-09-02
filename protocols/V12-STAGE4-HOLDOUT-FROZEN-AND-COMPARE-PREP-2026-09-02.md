# BuyFlow V12 — Stage 4 Holdout Frozen + One-Shot Compare Prepared

Date: 2026-09-02

## Frozen holdout evidence

Local freeze completed before any V11/V12 scoring.

- status: `V12_POSTTRAIN_HOLDOUT_V1_FROZEN`
- holdout SHA-256: `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`
- rows: `108`
- events: `18`
- rows per event: `6`
- languages: `hu,en,de,pl,fr,es`
- variants: `clean_plain,stale_subject,html_only,stale_snippet,quoted_history,metadata_noise`
- event-language matrix: complete
- event-variant matrix: complete
- synthetic/deidentified: `True`
- source rows copied: `False`
- training eligible: `False`
- tuning eligible: `False`
- model loaded at freeze: `False`
- V11 scored at freeze: `False`
- V12 scored at freeze: `False`
- protected holdouts read: `False`
- prior training corpus read: `False`
- prior hard-sibling rows read: `False`

Local corpus:
`local-data/lora-v12/posttrain-holdout-v1/cases.jsonl`

The exact SHA above is now the only accepted Stage 4 v1 corpus identity. Any content change requires a new versioned holdout and may not reuse this result.

## One-shot compare prepared

Prepared after the SHA was frozen:

- `scripts/v12-posttrain-holdout-compare-v1.py`
- `scripts/run-v12-posttrain-holdout-compare-v1.ps1`
- `scripts/BuyFlow-V12-POSTTRAIN-HOLDOUT-COMPARE.cmd`

The evaluator:

- requires exact frozen holdout SHA `03892ba760b46fbe32f64c1915dce77b67ccb162917e3119d78eaca14a3c8aba`;
- requires exact V11 adapter SHA `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`;
- requires exact V12 adapter SHA `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`;
- uses constrained output;
- scores V11 and V12 on the same 108 rows;
- does not train or mutate the corpus;
- does not read Fresh Blind v1, Input View Holdout v2, frozen108 or BLIND50;
- does not reveal per-case results while only one model has completed;
- refuses a second completed run if `FINAL_RESULT.json` already exists.

Final report includes overall exact accuracy, invalid outputs, case-wise V11/V12 wins, per-event, per-language, per-variant and wrong-transition summaries.

This is the final synthetic untouched Stage 4 generalization gate before deciding whether V12 can be promoted beyond development evidence. It is not a claim of universal real-world accuracy.
