# Generic Commerce / Unknown Merchant Shadow Gate

Status date: **2026-08-17**

## Purpose

BuyFlow already had a multi-language deterministic generic order-confirmation parser (`generic-order-confirmation-v1.2`). It is the last fallback in the central deterministic commerce parser after known carrier and merchant adapters.

This lane is useful because it can recognize a real order-confirmation structure from a merchant-owned sender domain even when BuyFlow has no dedicated merchant profile. However, an unknown merchant is not yet strong enough evidence for automatic Purchase creation without live false-positive measurement.

## Safety issue found

The generic parser can emit `order_created` with confidence between roughly 0.92 and 0.97 when it has a labeled order identity plus multiple corroborators such as total, payment method, shipping method, product rows or an order-details section.

Before this gate, the general validator could mark such evidence `validated`, and the automatic reconciliation write path trusts validated/guardrailed evidence. In write mode that created an unnecessary theoretical route from an unseen merchant template to automatic Purchase creation.

## Gate added

Generic commerce is now **shadow-only by parser identity**.

1. Every parser version matching `generic-order-confirmation-v...` is rejected by `isTrustedAutomaticEvidence`, regardless of stored validation status. This also protects older already-saved generic evidence.
2. Newly preprocessed generic order confirmations are forced to:
   - `validation_status = review`
   - `eligible_for_purchase_creation = false`
   - `shadow_only = true`
   - `would_write = false`
3. The existing production protocol registry remains unchanged and empty.
4. Known merchant-specific parsers are not globally downgraded by this rule.

## Live production-shadow diagnostics

The existing Gate B live observer now also evaluates whether the already-fetched Nylas message truly falls through the central deterministic parser to the generic order-confirmation parser.

Only true generic fall-throughs emit `[generic-commerce-shadow]`.

The diagnostic contains only:

- parser version
- candidate event type
- confidence
- fixed parser reason codes
- booleans for presence of order number, total, currency, payment method and shipping method
- product-row count
- an HMAC-based sender-domain fingerprint for grouping repeated candidates without logging the raw domain
- `validation_status = review`
- `eligible_for_purchase_creation = false`
- `would_write = false`

The diagnostic intentionally omits:

- raw sender address
- raw sender domain
- subject
- email body/snippet
- provider message/thread ID
- order number value
- monetary value
- product names
- customer address/email

The generic shadow lane has no database write callback. It is invoked from the existing Gate B observer, so its failures remain isolated from normal ingestion by the same outer production-shadow error boundary.

## What this does not authorize

This change does **not** authorize automatic creation or mutation of:

- Purchase
- Shipment
- Payment
- Invoice/document
- Return
- Refund
- Warranty

It also does not promote WooCommerce, Shopify, UNAS, Shoprenter or any other generic/platform profile into the production protocol registry.

## Next evidence gate

Use live shadow observations to measure:

1. generic candidate count
2. repeated distinct sender-domain fingerprints
3. overlap with later dedicated merchant profiles
4. false positives from marketing, abandoned cart, invoice-only, payment-only and shipment-only mail
5. languages/template families not covered today
6. whether a separate unknown-merchant review UI is useful

Only after a fresh mailbox audit and manual review should any narrower generic event be considered for a later promotion proposal. Automatic Purchase creation remains out of scope for this gate.
