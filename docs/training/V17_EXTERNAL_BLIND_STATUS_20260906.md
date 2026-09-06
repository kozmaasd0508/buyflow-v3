# BuyFlow V17 external blind status — 2026-09-06

## V1 — SPENT / diagnostic only

Dataset: `buyflow-v17-external-blind-v1`

Reason: the first baseline runner printed per-case expected gold labels and failures to the terminal. The set is therefore no longer an untouched holdout and must not be used as the final proof of training improvement.

Observed diagnostic baseline on Gemma 3 12B / V17.1:
- event_type: 23/30 = 76.67%
- perspective: 0/30
- order_id: 27/30 = 90%
- tracking_id: 29/30 = 96.67%
- link_status: 8/30 = 26.67%
- exact: 0/30
- errors: 0

Important interpretation: V1 baseline prompt did not constrain the allowed `perspective` and `link_status` enum values, so the model invented values such as `certain`, `confirmed`, and overused `merchant_outbound`. Exact=0 is therefore not a clean measure of semantic capability.

## V2 — FROZEN

Dataset: `buyflow-v17-external-blind-v2`

Policy:
- created only after the V17 teacher dataset was already frozen;
- use a fixed output contract for enum fields;
- baseline and post-training scoring print aggregate metrics only;
- do not print per-case gold or failure details;
- do not tune prompt/training data from V2 case-level results;
- if V2 case-level gold is inspected for tuning, mark V2 SPENT and create V3.

Training remains OFF until a valid V2 pre-training aggregate baseline is recorded.
