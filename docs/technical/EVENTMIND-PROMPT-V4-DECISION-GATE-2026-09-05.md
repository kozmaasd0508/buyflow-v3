# EventMind Prompt V4 decision-gate experiment — 2026-09-05

## Purpose

REAL120 is a development set. The previous V13-lite + chunk/final-judge path was technically stable but semantically weak: 44/120 strict exact (36.67%), with dominant OTHER/merchant-outbound and adjacent shipment-stage confusions.

This experiment changes only the EventMind chunk classifier instruction. It keeps the V11 Qwen3-8B adapter, local deterministic runtime, thinking OFF, memory-safe chunking, strict two-key JSON output, Gmail GET-only and production OFF.

## Prompt change

The new `real120-decision-gate-v4-memory-safe` instruction adds a compact decision procedure:

1. Buyer-side scope gate before lifecycle classification.
2. Merchant/seller/outbound courier collection is OTHER unless explicitly a buyer purchase return.
3. Primary current-status evidence outranks incidental wording, instructions, footers and older states.
4. Explicit boundaries for ORDER_CREATED / ORDER_PROCESSING / ORDER_PACKING.
5. Explicit shipment ladder: SHIPMENT_CREATED -> SHIPPED -> IN_TRANSIT -> OUT_FOR_DELIVERY -> READY_FOR_PICKUP -> DELIVERED, plus DELIVERY_FAILED and DELAYED.
6. PAYMENT vs INVOICE primary-event distinction.
7. CANCELLED / REFUNDED / RETURN / WARRANTY definitions.
8. `is_commerce` is derived after `event_type`: false only for OTHER.

No REAL120 ground-truth labels, message IDs or raw customer email bodies are embedded in the prompt or committed.

## Experimental gate

Run the same frozen REAL120 development set using the DIRECT local path and compare strict exact against the previous 44/120 result. Do not treat any REAL120 improvement as unbiased holdout evidence; a new untouched holdout is still required after candidate freeze.

Prompt code commit: `a61843c9e80a1c29582805e6e2f909595d855749`.
