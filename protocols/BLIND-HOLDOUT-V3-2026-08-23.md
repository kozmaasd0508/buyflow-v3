# Extraction Engine v2 — Blind Holdout v3 Protocol

Status: CANDIDATE FREEZE ESTABLISHED BEFORE V3 DATA SELECTION
Mode: EVALUATION ONLY · 0 WRITE · 0 AI

## Candidate freeze

Extraction Engine v2 candidate-freeze commit:

`e871ce25a842d061f55d359f017fe4fa14dd8f61`

The Blind Holdout v3 harness may be added after this commit, but no extractor, evidence collector, source adapter, resolver, validator, or lifecycle rule may be changed between v3 ground-truth freeze and the first v3 result. If any such production extraction logic changes, the unseen set must be versioned forward before it can be called blind again.

## Purpose

Blind Holdout v3 is the first evaluation intended to measure real correctness rather than agreement with the legacy engine. Legacy output is never ground truth and is not an input to annotation.

## Data selection

Use only messages that were not part of the familiar 100/300/500 shadow differential sets and were not used by Blind v1 or Blind v2. Prefer newly received real messages after the candidate freeze where possible.

The set should include:
- order_created
- payment_completed
- invoice_or_receipt
- shipment
- delivery
- return
- refund
- cancellation
- hard noise / non-commerce

Do not balance by copying parser outputs. Select from the mailbox first, then annotate from the original message content.

## Ground-truth annotation

Ground truth must be written before the frozen engine is run on the selected set.

Each field uses exactly one state:
- `known`: the original message proves the value
- `not_applicable`: the field should not exist for this message
- `unknown`: the message does not prove enough to judge the field

A parser-produced value must never be promoted into ground truth after the run.

Scored fields:
- eventType
- merchant
- orderNumber
- total
- currency
- carrier
- trackingNumber
- paymentStatus
- invoiceNumber
- paymentReference
- products

Store only an opaque/hash-like case id plus ground truth in the repository. Do not commit raw email subject/body content to the holdout truth file.

## Metrics

Detection:
- TP / FP / FN / TN
- precision
- recall

Per field:
- known count
- not_applicable count
- unknown count
- exact matches
- mismatches
- missing
- conflicts
- false positives
- false negatives
- precision
- recall
- exact-match rate

Safety summary:
- REVIEW count
- critical mismatch count

Critical fields are eventType, orderNumber, total, currency, carrier, trackingNumber, paymentStatus, invoiceNumber, and paymentReference.

`unknown` is excluded from scoring. A resolved value for `not_applicable` is a false positive. A wrong resolved value for `known` counts as both a field false positive and field false negative. A conflict on a known field counts as a false negative and is separately reported as a conflict.

## Anti-overfitting rule

The first v3 result is permanent baseline evidence. Once anyone views the engine result for the v3 cases, the set is no longer blind and may only be used for regression.

Any correction to ground truth after the first run must be documented and the corrected set must not be described as the original blind result.

## Cutover rule

No production cutover decision may be based on shadow-vs-legacy agreement alone. Cutover requires the frozen v3 report plus an explicit review of critical mismatches and REVIEW cases.
