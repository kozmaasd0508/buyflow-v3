# Order Lifecycle Correlation Blind Audit v1

Issue: #196

## Why this audit exists

The v7 recognition holdout proved event recognition on 100 frozen messages with 100% precision and 100% recall, while keeping 0 production writes and 0 AI calls. That does not yet prove that BuyFlow can assemble multiple emails into one correct purchase timeline.

## Existing resolution limitation

The current purchase resolver groups evidence by:

`userId :: senderDomain :: orderNumber`

This is intentionally conservative, but it means a webshop order email and a carrier/payment/invoice email from a different sender domain cannot automatically become the same purchase candidate solely through the current key. Cross-provider lifecycle correlation therefore needs its own shadow audit before any production promotion.

## Frozen blind-set design

Use 20 real purchases selected before correlation changes are made. For each purchase, collect all available lifecycle emails such as:

- order_created
- order_updated
- payment_completed / payment_failed
- invoice_or_receipt
- shipment
- delivery
- return
- refund
- cancellation when present

Ground truth is stored only in Gmail labels:

- `BuyFlow Lifecycle Audit/v1/P01` … `P20`
- `BuyFlow Lifecycle Audit/v1/Holdout`
- `BuyFlow Lifecycle Audit/v1/Noise`

No sender, subject, order number, tracking number, or other blind-set metadata is copied into repository fixtures.

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

The `/audit-lifecycle-v1` route reports:

- correlation precision
- correlation recall
- merge errors
- split errors
- orphan lifecycle events
- REVIEW count
- groups without an `order_created` anchor
- hard-noise false positives
- assignment reason for every message

## Initial acceptance gate

- correlation precision: 100%
- merge errors: 0
- unsafe auto-merges: 0
- split errors: 0, or all unresolved splits explicitly REVIEW
- hard-noise false positives: 0
- production writes: 0
- AI calls: 0

Recall is reported separately. Do not improve recall by weakening precision safeguards.

## Implemented shadow flow

1. Seed purchase groups only from `order_created` + exact order number.
2. Link cross-provider events by exact normalized order number when unique.
3. Learn tracking numbers only from already safely linked purchase evidence.
4. Link later carrier lifecycle messages by exact tracking number.
5. Keep ambiguous order/tracking matches in REVIEW.
6. Keep lifecycle-only events without a safe anchor in REVIEW.
7. Scan the frozen Gmail labels from `/audit-lifecycle-v1` without production writes or AI calls.
8. Compare the engine assignment against the Gmail P01–P20 ground truth and report merge/split/orphan errors.

## Next step

Freeze and label 20 real purchase histories in Gmail, add hard noise, then run the first blind correlation audit before changing the correlation rules again.
