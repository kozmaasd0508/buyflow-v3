# BuyFlow V12 — Stage 3C All-18 Retention Result

Date: 2026-09-02

## Exact result

Evaluator:
`scripts/BuyFlow-V12-RETENTION-COMPARE.cmd`

Development retention source:
- `V11_REPLAY_VALIDATION` only
- 288 rows
- 18 labels x 16 rows
- constrained output
- training: `False`
- corpus mutation: `False`
- frozen/protected holdouts read: `False`

Adapters:
- V11 SHA: `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- V12 SHA: `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`

Scores:
- V11: `288/288 = 100.00%`
- V12: `288/288 = 100.00%`
- exact delta: `+0`
- invalid V11: `0`
- invalid V12: `0`
- V11 wrong transitions: none
- V12 wrong transitions: none

Every event is `16/16` for both V11 and V12:
- CANCELLED
- DELAYED
- DELIVERED
- DELIVERY_FAILED
- INVOICE
- IN_TRANSIT
- ORDER_CREATED
- ORDER_PACKING
- ORDER_PROCESSING
- OTHER
- OUT_FOR_DELIVERY
- PAYMENT
- READY_FOR_PICKUP
- REFUNDED
- RETURN
- SHIPMENT_CREATED
- SHIPPED
- WARRANTY

Local metrics:
`local-data/lora-v12/retention-replay-v1/retention-compare/runs/20260902T103814Z/metrics.json`

## Interpretation

This development retention gate is a clean PASS: no measurable regression appeared on the 288 replay-validation rows across any of the 18 labels.

This does **not** prove broad real-world improvement because these are development retention rows and both models score 100%. The separate 72-row hard-sibling development set still shows V12 at `71/72` versus V11 `70/72`, with one remaining reverse `ORDER_PACKING -> ORDER_PROCESSING` stale-snippet error.

Do not tune again on either development set before a new untouched gate.

## Next gate

Create and lock a brand-new post-V12 untouched holdout that:
- contains no rows from V11/V12 training, teacher queue, hard-sibling validation, Fresh Blind, Input View Holdout, frozen108 or BLIND50;
- covers all 18 labels;
- uses new wording/representation families and multiple languages;
- is SHA-locked before model inference;
- compares exact unchanged V11 and exact V12 with constrained decoding;
- is run once before any further tuning.

Only that new holdout should decide whether V12 deserves promotion beyond development evidence.
