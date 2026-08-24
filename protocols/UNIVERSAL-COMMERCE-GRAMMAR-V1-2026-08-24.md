# Universal Commerce Grammar v1

Date: 2026-08-24

## Goal
Build merchant-independent commerce event understanding for emails from shops BuyFlow has never seen before.

This layer must not ask "which webshop is this?" before understanding the event. It asks "what does the message prove?".

## Safety mode
- deterministic
- 0 AI calls
- shadow-only
- 0 production writes
- no Purchase/Shipment creation authority yet
- merchant-specific names are not required for recognition

## Lifecycle vocabulary
- order_created
- order_processing
- order_cancelled
- shipment_created
- shipped
- out_for_delivery
- delivered
- invoice
- payment_completed
- payment_issue
- refund
- return
- review_request
- unknown

## Core rule
A phrase alone is not enough for automatic authority when independent corroboration is expected. Structural evidence can include order identity, tracking identity, order-summary structure, product rows, money, payment method, shipping method and carrier evidence.

## Negative evidence is first-class
Examples:
- review/rating request -> block new-order interpretation
- `hamarosan átadjuk a futárnak` / `feladásra vár` -> not shipped yet
- explicit cancellation -> order_cancelled, never order_created

## Intended user journey
Friday: order confirmation -> Purchase can eventually appear as order_created.
Tuesday: same order is explicitly handed to carrier -> shipped.
Later courier messages -> out_for_delivery -> delivered.
Identity Graph will link these events after this recognition layer is proven safe.

## Testing direction
Do not optimize against merchant names from the historical sample. Validate on held-out merchants that were not used to create rules. A change is valuable only if it improves unknown-merchant generalization without creating unsafe false positives.
