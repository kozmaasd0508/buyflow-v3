# Phase D · Fresh Blind Lifecycle Audit · First Score · 2026-08-25

This score is immutable. Do not rewrite it after fixes.

## Frozen inputs
- fixture freeze commit: `bf3c6efd4b79ff2fd876016e0f1fde9c8e51f1fb`
- first executable harness commit: `f00a3dae782e2cf20e8d36b6abaa296751b33e7d`
- CI: #1009
- mode: full `EmailDocumentV1 -> Extraction Engine v2 -> CanonicalEvent -> Purchase Identity Graph v2` shadow
- production writes: 0
- AI calls: 0

## Raw first score
- fixtures: 14
- correct automatic outcomes: 5
- safe misses: 1
- negative controls passed: 6
- raw failing assertions: 2

### Raw failures
1. `ecwid-order-confirmed`: `NEW_PURCHASE` was correctly chosen, but the harness compared the graph's normalized stored order identity to the fixture's formatted order identity and reported `NEW_PURCHASE created without expected order identity`.
2. `ecwid-order-cancelled-without-refund-claim`: event was incorrectly classified as `refund_created`; it linked to the correct Purchase but projected state `refunded` instead of `cancelled`.

## Interpretation frozen with first score
- Failure 1 is a blind-harness representation bug, not a production correlation error. The expected semantic identity was the same order; comparison must use the same stable identifier normalization used by the graph. Fixture text/expectation remains unchanged.
- Failure 2 is a genuine safety bug: explicit negation (`does not state that a refund was issued`) must not be accepted as completed refund evidence.

## Per-fixture first observations
- `ecwid-order-confirmed` -> `order_created` / `NEW_PURCHASE` / mutated
- `ecwid-order-shipped-with-tracking` -> `shipment_created` / `LINKED` / mutated
- `dpd-out-for-delivery-by-tracking` -> no canonical event / no decision / safe miss
- `dpd-delivered-by-tracking` -> `delivered` / `LINKED` / mutated
- `ecwid-order-refunded` -> `refund_created` / `LINKED` / mutated
- `squarespace-refund-initiated-not-completed` -> no canonical event / no decision / safe negative
- `ecwid-order-cancelled-without-refund-claim` -> **incorrect `refund_created` / `LINKED` / mutated to refunded**
- `squarespace-shared-sender-order-confirmed` -> `order_created` / `REVIEW` / no mutation
- `merchant-invoice-exact-order` -> `invoice_created` / `LINKED` / mutated
- `merchant-payment-success-exact-order` -> `payment_completed` / `LINKED` / mutated
- `stripe-provider-reference-alone` -> `refund_created` / `REVIEW` / no mutation
- `cross-merchant-same-order-id` -> `shipment_created` / `REVIEW` / no mutation
- `ambiguous-duplicate-order-id` -> `shipment_created` / `REVIEW` / no mutation
- `invoice-provider-order-id-without-merchant-namespace` -> `invoice_created` / `REVIEW` / no mutation

## Safety conclusion at first score
Phase D merge gate: **FAIL** because one real false lifecycle promotion exists (`cancelled` -> `refund_created/refunded`).

No wrong-Purchase automatic link and no cross-merchant merge was observed in this first run.
