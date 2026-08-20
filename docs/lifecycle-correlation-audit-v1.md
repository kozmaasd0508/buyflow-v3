# Order Lifecycle Correlation Blind Audit v1

Issue: #196

## Why this audit exists

The v7 recognition holdout proved event recognition on 100 frozen messages with 100% precision and 100% recall, while keeping 0 production writes and 0 AI calls. That does not yet prove that BuyFlow can assemble multiple emails into one correct purchase timeline.

## Existing resolution limitation

The current purchase resolver groups evidence by:

`userId :: senderDomain :: orderNumber`

This is intentionally conservative, but it means a webshop order email and a carrier/payment/invoice email from a different sender domain cannot automatically become the same purchase candidate solely through the current key. Cross-provider lifecycle correlation therefore needs its own shadow audit before any production promotion.

## Frozen blind-set design

Use 20–30 real purchases selected before correlation changes are made. For each purchase, collect all available lifecycle emails such as:

- order_created
- order_updated
- payment_completed / payment_failed
- invoice_or_receipt
- shipment
- delivery
- return
- refund
- cancellation when present

Include difficult cases:

- webshop + external payment provider
- webshop + carrier
- webshop + invoice provider
- multiple orders from the same merchant close in time
- repeated subjects
- multiple shipments for one order
- lifecycle-only messages without a safe order anchor
- unrelated hard noise mixed into the mailbox set

Ground truth must be frozen before the first run and must not be edited in response to audit failures.

## Correlation evidence hierarchy

Strong evidence:

1. exact normalized order number shared with an existing purchase
2. exact tracking number already linked to a shipment/purchase
3. explicit merchant order reference embedded in carrier/payment/invoice content

Conditional evidence:

4. verified merchant/provider relationship + compatible merchant + bounded time window
5. amount/currency + merchant + time window, only when the candidate is unique

Unsafe by itself:

- sender domain only
- subject similarity only
- invoice id only
- amount only
- broad time proximity only

If more than one purchase remains plausible, decision must be REVIEW. No automatic merge.

## Safety invariants

- lifecycle-only email never creates a new purchase without safe order-created anchoring
- carrier sender never creates a purchase
- ambiguous candidates go to REVIEW
- no test-specific sender/subject hardcoding in production correlation logic
- 0 production writes
- 0 AI calls

## Metrics

Report at least:

- correlation precision
- correlation recall
- exact purchase timeline accuracy
- merge errors
- split errors
- orphan lifecycle events
- REVIEW count
- cross-provider match accuracy
- lifecycle ordering correctness

## Initial acceptance gate

- correlation precision: 100%
- merge errors: 0
- unsafe auto-merges: 0
- split errors: 0, or all unresolved splits explicitly REVIEW
- production writes: 0
- AI calls: 0

Recall is reported separately. Do not improve recall by weakening precision safeguards.

## Implementation order

1. Add a shadow-only correlation audit model and result types.
2. Build deterministic candidate scoring/reason reporting without writes.
3. Add frozen fixtures / mailbox ground truth for 20–30 purchases.
4. Add `/audit-lifecycle-v1` and a shadow API endpoint.
5. Run first blind audit before changing correlation rules.
6. Fix only evidenced failure classes, then rerun as regression.
