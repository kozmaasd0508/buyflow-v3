# BuyFlow V17 Teacher Dataset

Status: TRAINING DATA PREPARATION ONLY. Production remains OFF.

## Goal
Teach Gemma the BuyFlow semantic boundaries with examples instead of growing the runtime prompt into a rulebook.

## Frozen split
- `train.jsonl`: 240 examples used for LoRA training
- `validation.jsonl`: 30 examples used during evaluation/tuning
- `blind.jsonl`: 30 examples never used for training or prompt tuning
- `manifest.json`: counts, seed and SHA-256 hashes

The blind split is frozen by the generator seed. If any blind example is inspected and then used to change training/prompt behavior, that blind set is considered spent and a new blind seed must be created.

## Core boundaries emphasized
1. Label/data created while the carrier has not physically received the parcel -> `SHIPMENT_CREATED`.
2. Explicit physical handoff to carrier -> `SHIPPED`.
3. Moving through carrier network -> `IN_TRANSIT`.
4. On courier vehicle / scheduled for delivery today -> `OUT_FOR_DELIVERY`.
5. Available at locker/pickup point -> `READY_FOR_PICKUP`.
6. Successfully handed to recipient -> `DELIVERED`.
7. A real lifecycle email can remain `unresolved` when there is no hard purchase link. Do not downgrade it to `OTHER` merely because the purchase is unknown.
8. `merchant_outbound` is direction/perspective, not a synonym for emails sent by merchants or carriers. It means the mailbox owner is the merchant/sender and the carrier is collecting or moving the mailbox owner's customer parcels.
9. Marketing, security, surveys and unrelated account notices -> `OTHER` / `non_purchase`.
10. Linking requires hard evidence such as exact order ID or exact tracking ID. No domain/time guessing.

## Example format
Each JSONL row contains a chat-style supervised example plus metadata. The assistant target is strict JSON with:
- `event_type`
- `perspective`: `buyer`, `merchant_outbound`, or `non_purchase`
- `order_id`
- `tracking_id`
- `link_status`: `linked`, `unresolved`, or `not_applicable`
- `evidence`

## Important
Synthetic examples are only the first teaching layer. Real Gmail examples should later be added after privacy review and human labeling. Synthetic accuracy alone is not enough to approve production.
