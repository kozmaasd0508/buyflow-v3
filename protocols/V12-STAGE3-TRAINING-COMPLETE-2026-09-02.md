# BuyFlow V12 — Stage 3 Training Complete

Date: 2026-09-02

## Result

Local continuation QLoRA completed successfully from the unchanged V11 best adapter.

- status: `V12_TRAINING_COMPLETE`
- model: `Qwen/Qwen3-8B`
- GPU: `AMD Radeon RX 9060 XT`
- parent V11 adapter SHA-256: `462db0d03ee2f9e8d95e288700a153ca422a7feba8fa5ba93c0f6b0600352c0b`
- parent V11 unchanged: `True`
- TRAIN SHA-256: `81c4a92bcdb22d58215ee51f1fc193415ab72c54141d6e97d12dd3766f60f00a`
- validation SHA-256: `d2c6a2d60c9739d81c0afda7e051c558578e93933ee72e2f82fd66ba27bfbfd6`
- TRAIN rows: `1296`
- validation rows: `360`
- events retained: `18`
- hard boundary: `ORDER_PROCESSING vs ORDER_PACKING`
- epochs: `1`
- gradient accumulation: `4`
- optimizer steps: `324/324`
- learning rate: `2e-5`
- max sequence: `768`
- train loss: `0.000222`
- validation loss: `0.000007`
- best epoch: `1`
- training minutes: `66.36`
- GPU peak allocated: `10.13 GiB`
- best adapter SHA-256: `5addcbce953f99e59ef345b14ea237daafeb2566e45a3d1e94d0459cd163f630`
- adapter saved: `True`
- frozen holdouts read: `False`
- frozen108 trained: `False`
- BLIND50 trained: `False`

Local best adapter:
`local-data/lora-v12/runs/20260902T085426Z-qwen3-8b-buyflow-v12-retention-robustness/best`

Local metrics:
`local-data/lora-v12/runs/20260902T085426Z-qwen3-8b-buyflow-v12-retention-robustness/metrics.json`

## Interpretation

Training itself is complete and the safety gates passed. The lower validation loss is only an optimization signal; it is not sufficient evidence that V12 is behaviorally better than V11.

The fixed pre-training hard-sibling baseline is still `70/72 = 97.22%` with two `ORDER_PROCESSING -> ORDER_PACKING` errors.

## Next gate

Run the new post-training evaluator:

`scripts/BuyFlow-V12-HARD-SIBLINGS-POSTTRAIN.cmd`

It uses the exact saved V12 adapter SHA above, the same fixed 72 hard-sibling validation rows and the constrained decoder. It does not train, does not mutate the corpus and does not read frozen holdouts.

Only after this exact before/after score should we decide whether the narrow target boundary improved. Then run a separate all-18-label retention check before creating a brand-new untouched post-V12 holdout.
