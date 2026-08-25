# Phase D · Fresh Blind Lifecycle Audit · Post-Fix Score · 2026-08-25

## Frozen inputs
- fixture freeze commit: `bf3c6efd4b79ff2fd876016e0f1fde9c8e51f1fb`
- fixture contents and expectations were not changed after first execution
- immutable first score: `protocols/PHASE-D-FRESH-BLIND-FIRST-SCORE-2026-08-25.md`
- post-fix code snapshot: `b423ebe30b0b2cf6298a1785cfd50a82a638f1c7`
- CI: #1015
- mode: full `EmailDocumentV1 -> Extraction Engine v2 -> CanonicalEvent -> Purchase Identity Graph v2` shadow
- production writes: 0
- AI calls: 0

## What changed after the first score
1. The blind harness now compares the expected new order identity through the same stable identifier normalization used by the graph. This was a harness-only representation correction; the frozen fixture and semantic expectation were not changed.
2. Generic explicit refund-negation handling was added to the universal event-type extraction path.
3. The same generic refund-negation safety was added to the universal payment-status path so corroborated refund evidence cannot reintroduce the false promotion through a second extractor.
4. Regression tests cover English and Hungarian explicit negation, while preserving genuine completed-refund recognition.

No merchant-specific rule, merchant name, production order id, or user mailbox data was added.

## Post-fix score
- fixtures: 14
- correct automatic outcomes: 7
- safe misses: 1
- negative controls passed: 6
- unsafe outcomes: 0
- wrong automatic Purchase links: 0
- cross-merchant merges: 0
- unsafe second-Purchase creation from lifecycle mail: 0
- refund-initiated -> completed refund false promotion: 0
- explicit refund negation -> completed refund false promotion: 0

### One safe miss
`dpd-out-for-delivery-by-tracking` remained without a canonical automatic event in this synthetic E2E context. It did not mutate the graph and did not link to a wrong Purchase. Under the Phase D precision-first gate this is an acceptable recall miss.

## Exact post-fix observations
- `ecwid-order-confirmed` -> `order_created` / `NEW_PURCHASE`
- `ecwid-order-shipped-with-tracking` -> `shipment_created` / `LINKED`
- `dpd-out-for-delivery-by-tracking` -> no canonical event / safe miss
- `dpd-delivered-by-tracking` -> `delivered` / `LINKED`
- `ecwid-order-refunded` -> `refund_created` / `LINKED`
- `squarespace-refund-initiated-not-completed` -> no canonical event / safe negative
- `ecwid-order-cancelled-without-refund-claim` -> `cancelled` / `LINKED`
- `squarespace-shared-sender-order-confirmed` -> `order_created` / `REVIEW`
- `merchant-invoice-exact-order` -> `invoice_created` / `LINKED`
- `merchant-payment-success-exact-order` -> `payment_completed` / `LINKED`
- `stripe-provider-reference-alone` -> `refund_created` / `REVIEW`
- `cross-merchant-same-order-id` -> `shipment_created` / `REVIEW`
- `ambiguous-duplicate-order-id` -> `shipment_created` / `REVIEW`
- `invoice-provider-order-id-without-merchant-namespace` -> `invoice_created` / `REVIEW`

## CI #1015
On code snapshot `b423ebe30b0b2cf6298a1785cfd50a82a638f1c7`:
- API typecheck: PASS
- API tests: **1215/1215 PASS**
- API build: PASS
- Mobile typecheck: PASS
- Mobile web build: PASS

## Phase D gate
**PASS**

Reason: automatic correlation retained zero observed false links/merges on the frozen fresh blind set, all ambiguity/provider/cross-merchant controls failed closed, the discovered refund-negation safety bug was fixed generically, and the full project CI is green with 0 AI and 0 production writes.
