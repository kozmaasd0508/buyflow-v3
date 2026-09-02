# BuyFlow V12 — Stage 3 Retention Continuation Train V1

Date: 2026-09-02

## Entry gate

Retention replay merge completed locally with:
- status `V12_RETENTION_REPLAY_V1_READY`
- V11 canonical corpus signature PASS: 5760 TRAIN / 576 validation / 18 balanced events
- replay TRAIN 1152 + hard TRAIN 144 = merged TRAIN 1296
- replay validation 288 + hard validation 72 = merged validation 360
- TRAIN ORDER_PROCESSING 136 / ORDER_PACKING 136 / every other event 64
- validation ORDER_PROCESSING 52 / ORDER_PACKING 52 / every other event 16
- exact TRAIN/validation overlap 0
- frozen holdouts read False
- merged TRAIN SHA-256 `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- merged validation SHA-256 `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`

No training occurred during the merge step.

## Parent adapter

The continuation run must use the unchanged V11 `best` adapter from:
`local-data/lora-v11/runs/20260830T194827Z-qwen3-8b-buyflow-v11-normalized-semantic/best`

Expected parent adapter SHA-256:
`462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`

The parent adapter is loaded trainably but is never overwritten. V12 saves into a separate `local-data/lora-v12/runs/...` child run.

## Conservative first run

- epochs: 1
- learning rate: 2e-5
- gradient accumulation: 4
- max sequence: 768
- model: Qwen3-8B NF4
- continuation target: same causal JSON semantic output as V11
- train: 1296
- validation: 360
- all 18 events retained

Reason for conservative LR: the existing V11 already scores 70/72 on the hard-sibling validation set. The objective is to correct a narrow evidence-priority weakness without erasing the broader lifecycle knowledge.

## Safety

The trainer hard-fails unless:
- merged TRAIN/validation file hashes match the recorded entry-gate hashes;
- parent V11 adapter SHA matches the recorded V11 adapter;
- all 18 event labels are present with the expected merged class counts;
- exact train/validation overlap is zero;
- retention manifest states all protected/frozen evaluation reads are false.

The trainer must not read or train on:
- Fresh Blind v1
- Input View Holdout v2
- frozen108
- BLIND50
- locked tests
- raw customer Gmail content

Qwen remains semantic-only. Identity and Purchase linkage remain under the deterministic Zero-Trust resolver.

## Success output

The run is not considered complete until it prints:
- optimizer step count equal to expected total
- best epoch and validation loss
- best child-adapter SHA
- `parent_v11_unchanged: True`
- `frozen_holdouts_read: False`
- `adapter_saved: True`
- `status: V12_TRAINING_COMPLETE`

## After training

Do not claim improvement from validation loss alone. Next, score the saved V12 best child adapter with the constrained decoder on:
1. the 72 hard-sibling validation rows for exact before/after;
2. a retention check spanning all 18 labels that is not part of TRAIN;
3. only then a brand-new untouched post-V12 holdout.

Protected old holdouts stay frozen during tuning.
