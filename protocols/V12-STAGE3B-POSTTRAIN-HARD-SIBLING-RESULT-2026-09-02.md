# BuyFlow V12 — Stage 3B Post-Train Hard-Sibling Result

Date: 2026-09-02

## Exact post-train result

Evaluator:
`scripts/BuyFlow-V12-HARD-SIBLINGS-POSTTRAIN.cmd`

Model:
- Qwen3-8B NF4
- V12 best adapter SHA: `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- parent V11 SHA verified: `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- constrained output enabled
- training: `False`
- corpus mutation: `False`
- frozen holdouts read: `False`

Fixed 72 hard-sibling validation rows:
- V11 baseline: `70/72 = 97.22%`
- V12 post-train: `71/72 = 98.61%`
- exact delta: `+1`
- invalid: `0`
- wrong: `1`

Per event:
- `ORDER_PROCESSING`: V11 `34/36` -> V12 `36/36`
- `ORDER_PACKING`: V11 `36/36` -> V12 `35/36`

Representation variants after V12:
- clean_plain `12/12`
- html_body `12/12`
- metadata_order_shift `12/12`
- misleading_subject `12/12`
- quoted_old_state `12/12`
- stale_snippet `11/12`

Only remaining wrong transition:
- `ORDER_PACKING -> ORDER_PROCESSING` x1

Local metrics:
`local-data/lora-v12/hard-siblings-v2/posttrain-v12/runs/20260902T101119Z/metrics.json`

## Interpretation

V12 shows a net improvement of one exact case on this fixed development set. The originally confirmed weak direction `ORDER_PROCESSING -> ORDER_PACKING` is fully corrected on these rows, but one reverse error appears on a stale-snippet representation.

This is therefore **not** a perfect boundary result and is not yet evidence of broad model improvement. Do not tune again from this single 72-row set before checking retention across all 18 labels.

## Next gate

Run:
`scripts/BuyFlow-V12-RETENTION-COMPARE.cmd`

This evaluator compares exact unchanged V11 vs V12 behavior on the 288 `V11_REPLAY_VALIDATION` rows only:
- 18 labels
- 16 rows per label
- constrained output
- no training
- no corpus mutation
- no Fresh Blind / Input View Holdout / frozen108 / BLIND50 read

This is development retention evidence, not a new untouched holdout.

Only after retention is acceptable should a brand-new untouched post-V12 holdout be created and run.
