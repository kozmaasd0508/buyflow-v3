# BuyFlow V12 — Stage 2 Retention Replay V1

Date: 2026-09-02

## Why

The hard-sibling validation baseline is already strong (`70/72 = 97.22%`) and the two remaining errors are both the confirmed `ORDER_PROCESSING -> ORDER_PACKING` evidence-priority failure. Fine-tuning only on the 144 two-class hard rows would create unnecessary catastrophic-forgetting risk for the other 16 lifecycle labels.

## Baseline entering this gate

Hard-sibling corpus SHA-256:
`f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf`

Unchanged V11 + constrained output on 72 validation siblings:
- exact: `70/72 = 97.22%`
- invalid: `0`
- ORDER_PACKING: `36/36`
- ORDER_PROCESSING: `34/36`
- misleading_subject: `11/12`
- metadata_order_shift: `11/12`
- all other representation variants: `12/12`
- wrong transition: `ORDER_PROCESSING -> ORDER_PACKING` x2

## Replay construction

The builder must locate the original V11 synthetic TRAIN/validation corpora by their frozen structural facts:
- TRAIN: `5760` rows, 18 events, exactly `320/event`
- validation: `576` rows, 18 events, exactly `32/event`

Protected/evaluation path families are excluded from discovery, including Fresh Blind, Input View Holdout, frozen108, BLIND50 and other holdout markers.

Deterministic replay sample:
- V11 TRAIN: `64/event` = `1152` replay rows
- V11 validation: `16/event` = `288` replay rows

Add hard siblings:
- hard TRAIN: `144` rows = `72 ORDER_PROCESSING + 72 ORDER_PACKING`
- hard validation: `72` rows = `36 + 36`

Expected merged TRAIN:
- `1296` total
- ORDER_PROCESSING: `136`
- ORDER_PACKING: `136`
- each other event: `64`

Expected merged validation:
- `360` total
- ORDER_PROCESSING: `52`
- ORDER_PACKING: `52`
- each other event: `16`

## Safety gates

- no training in this step;
- no frozen evaluation row read or copied;
- exact TRAIN/validation row overlap must be zero;
- record source file hashes and merged file hashes;
- V11 adapter remains unchanged;
- hard-sibling validation rows remain validation-only;
- Qwen remains semantic-only; Zero-Trust resolver retains identity/link authority.

## Next gate

Only after `V12_RETENTION_REPLAY_V1_READY` is produced with the expected counts should a V12 continuation-training script be prepared. Training should start from the V11 adapter as a separate child run, use a conservative learning rate/one initial epoch, and save a distinct V12 adapter without modifying V11.
