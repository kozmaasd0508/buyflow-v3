# Unknown Webshop Semantic Composition Holdout v1 — first baseline

Date: 2026-08-24

## Frozen code
Scored semantic-composition snapshot: `3712d949d26110984a67cba2a5c7551ce0c23428`

The 9 candidate messages were selected and hashed before their contents were read. No grammar, semantic or composition rule was changed before this result was recorded.

## Post-freeze ground truth
The holdout unexpectedly contained **0 real final invoice deliveries**.

Composition:
- final invoice/document deliveries: **0**
- non-final invoice/proforma/payment-request documents: **0**
- unrelated newsletter / educational / product-information / account-information messages: **9**

Several messages mention invoice concepts in educational or promotional context, but none contains a real delivered invoice attachment. All 9 have **0 attachments**.

Examples of semantic traps represented in the set, stated without raw private values:
- newsletter articles containing financial/account terminology,
- invoicing-software educational mail discussing invoices and webshop orders,
- product-information mail about attaching warranty documents to future orders,
- loyalty/service marketing about requesting an invoice,
- general account and terms information.

## Frozen composition replay
The Semantic Composition Engine v1 requires visible invoice meaning plus delivery/availability semantics and, for automatic invoice promotion, a real non-inline PDF attachment.

Because none of the 9 messages has a PDF attachment, none can satisfy the automatic invoice composition gate.

Expected composition outcome on the frozen rules:
- automatic invoice lifecycle promotions: **0 / 9**
- wrong automatic lifecycle promotions: **0 / 9**
- safety holds (`review` / no canonical lifecycle): **9 / 9**

## First holdout result
This is a **negative/safety holdout only**, not a positive invoice-coverage benchmark.

Safety result on this holdout:
- **9/9** unrelated invoice-looking messages are held without automatic invoice promotion
- **0** false automatic invoice events
- **0** merchant-specific adapter dependency in the composition decision

## What this proves
1. The new `INVOICE + PDF + sent/attached/available` composition does not fire merely because the word invoice appears in a marketing or educational message.
2. A technical or visible invoice concept without a real invoice-delivery structure remains non-authoritative.
3. The new composition layer remains conservative on invoice-looking noise.

## What this does NOT prove
This holdout contained no real final invoice delivery, so it does **not** measure positive invoice recall/generalization.

The earlier v2 regression case proves the intended rule can recover one historical unknown-merchant PDF invoice, but that case is no longer blind and is not counted here as holdout accuracy.

## Next step
Freeze a fresh **positive-enriched unseen document holdout** using ID-only selection that requires an attachment and independent invoice/document hints, then score the same frozen composition snapshot before any further rule changes.

After this baseline, these 9 messages are regression-only.
