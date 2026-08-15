# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous detailed entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-16 — Protocol / Merchant Library research wave 1

### Goal

After building the Protocol Library foundation, research the first commerce-engine wave from primary sources and begin merchant-specific knowledge, without enabling AI, replacing the current deterministic pipeline, or inventing unsupported email subjects.

### Foundation reference

PR #99 added the common versioned evidence/provenance/prohibition contract. Production registry remains empty; research profiles do not alter live recognition.

### PR #101 — WooCommerce research v1

Added:
- `apps/api/src/protocols/profiles/woocommerce-research-v1.ts`
- tests
- `protocols/commerce/woocommerce/1.0.0-research.1/README.md`

Primary-source findings:
- Processing -> ORDER_PROCESSING only
- Failed order -> PAYMENT_FAILED
- Cancelled -> CANCELLED
- historical Customer Invoice class is Order details/payment request; explicit payment copy required for PAYMENT_ACTION_REQUIRED and never fiscal INVOICE by class name
- full/partial refund is merchant refund evidence with DO_NOT_MARK_REFUNDED
- fulfillment-created -> merchant SHIPPED evidence, never DELIVERED
- Completed deliberately unmapped to SHIPPED/DELIVERED
- customer note/account/reset-password are hard negatives

PR CI #491 green.

### PR #102 — Shopify research v1

Added source-backed Shopify catalog and tests.

Key constraints:
- notification subject and HTML are merchant-editable/localizable
- no speculative raw subject regexes were added
- `shopifyemail.com` is shared platform evidence only and cannot identify merchant/Purchase
- Order confirmation, fulfillment/shipping, tracking, cancel/refund, pending-payment, pickup, return/exchange and local-delivery semantics are catalogued
- Shipping confirmation -> SHIPMENT_CREATED, not carrier physical progress
- Ready for pickup != Delivered
- refund evidence carries DO_NOT_MARK_REFUNDED
- Picked up is left OTHER until canonical taxonomy supports it
- `confirmation_number` is not treated as guaranteed globally unique

PR CI #493 green.

### PR #103 — UNAS + Shoprenter research v1

Merged runtime `8f4e0aa343d5d8bcbe094333cbeda5c1c0cab955`.
- PR CI #495 green
- main CI #496 green
- exact Render smoke #390 green

UNAS:
- highly customizable; no executable raw parser in v1
- recorded structural placeholders: order key/total/status, payment URL, tracking URL, package number, product block
- merchant-defined status names cannot be globally translated to lifecycle
- tracking/package identity does not prove physical carrier progress
- failed/pending payment family remains unmapped until rendered evidence distinguishes state

Shoprenter:
- documented shared fallback `order@myshoprenter.hu` -> platform OTHER only
- subjects/text/HTML editable
- order confirmation can later support ORDER_CREATED only with merchant + stable identity
- status change remains merchant-specific
- Shoprenter Go tracking link = identity only, not shipped/in-transit/delivered
- payment description = method/instruction, not payment success

### PR #104 — eMAG HU merchant research v1

First Hungarian merchant-specific research catalog.

Merged runtime `3c648b87ff3c8335102af7b71e94cc05cefdedfd`.
- PR CI #497 green
- main CI #498 green
- exact Render smoke #392 green

Official-source safety findings:
- eMAG Marketplace platform and actual seller are separate identities
- Folyamatban is seller preparation, not shipment
- AWB generation can move Marketplace order to Befejezett; this is at most SHIPMENT_CREATED, never physical shipment/delivery proof
- one order can have multiple parcels/AWBs; keep multiple Shipment identities
- easybox pickup notification -> READY_FOR_PICKUP, never DELIVERED
- cancellation != refund
- return request -> collection/receipt/inspection/approval -> refund are separate stages
- merchant/platform refund cannot finalize settled REFUNDED without stronger payment evidence
- online-card failure alone cannot create/guess a Purchase
- invoice/warranty document availability is separate from exact PDF/email identity and active warranty case

No stable first-party customer-email sender/subject/body set was found in the first pass, so no eMAG subject strings were invented and no raw parser was enabled.

### Research wave 1 checkpoint

Completed research coverage:
1. WooCommerce
2. Shopify
3. UNAS
4. Shoprenter
5. eMAG HU

All remain `research` / unregistered for live lifecycle extraction. No production inbox scans or new data writes were caused by this research.

The user asked to review the first phase before moving to the next large group, so stop here for review.

### Benchmark requirement before promotion

Permanent PR #97 benchmark remains the guardrail:
- 70 purchase/lifecycle fixtures + 30 noise
- 30/30 noise excluded
- 0 wrong order/tracking identities
- 0 unsafe lifecycle promotions
- unseen generic recognition 9/70 baseline

Any future `research -> test/production` promotion must re-run this and preserve false Purchase=0 and wrong auto-link=0.

### Candidate next work after approval

- Merchant research: MediaMarkt -> GymBeam -> Notino, or
- collect observed rendered Woo/Shopify/UNAS/Shoprenter/eMAG customer emails and begin safe executable `test` profiles.
