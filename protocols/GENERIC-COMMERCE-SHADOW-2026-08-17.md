# Generic Commerce / Unknown Merchant Shadow Gate

Status date: **2026-08-17**

## Purpose

BuyFlow has a multi-language deterministic generic order-confirmation parser. The current hardened version is `generic-order-confirmation-v1.4`. It is the last fallback in the central deterministic commerce parser after known carrier and merchant adapters.

This lane is useful because it can recognize a real order-confirmation structure from a merchant-owned sender domain even when BuyFlow has no dedicated merchant profile. However, an unknown merchant is not yet strong enough evidence for automatic Purchase creation without live false-positive measurement.

## Safety issue found

The generic parser can emit `order_created` with confidence between roughly 0.92 and 0.97 when it has a labeled order identity plus multiple corroborators such as total, payment method, shipping method, product rows or an order-details section.

Before the shadow gate, the general validator could mark such evidence `validated`, and the automatic reconciliation write path trusts validated/guardrailed evidence. In write mode that created an unnecessary theoretical route from an unseen merchant template to automatic Purchase creation.

## Gate added

Generic commerce is **shadow-only by parser identity**.

1. Every parser version matching `generic-order-confirmation-v...` is rejected by `isTrustedAutomaticEvidence`, regardless of stored validation status. This also protects older already-saved generic evidence.
2. Newly preprocessed generic order confirmations are forced to:
   - `validation_status = review`
   - `eligible_for_purchase_creation = false`
   - `shadow_only = true`
   - `would_write = false`
3. The existing production protocol registry remains unchanged and empty.
4. Known merchant-specific parsers are not globally downgraded by this rule.

## Live mailbox audit before v1.4

A read-only rolling two-year audit reviewed **9,437 messages** without database writes or production-registry use.

Observed generic funnel:
- 12 raw generic candidates
- 9 unprofiled candidates
- 7 unprofiled sender families
- 2 strong candidates

All 9 unprofiled candidates were manually reviewed. The audit exposed two safety classes that v1.3 did not cover broadly enough:

1. **Explicit contract / offer non-acceptance.** Some structurally rich order-received emails contain order ID, total, payment and shipping evidence but explicitly state that the automatic acknowledgement does not form a contract or accept the buyer's offer. Positive confirmation wording elsewhere in the same email does not override that explicit negative statement.
2. **Quoted historical order content.** A later merchant reply can quote the complete original order confirmation. The quoted old message must not become a second `ORDER_CREATED` candidate.

The reviewed normal order-received/recorded messages remain useful as conservative order anchors when they do not contain an explicit non-acceptance statement.

## v1.4 hardening

`generic-order-confirmation-v1.4` adds two narrow guards to the generic lane only.

### Explicit non-acceptance / contract-formation guard

The parser now rejects current-message wording that explicitly says, in Hungarian or English, that the acknowledgement:
- does not constitute order/offer acceptance,
- does not mean a contract was formed/concluded,
- does not mean contract formation,
- only acknowledges receipt of the order/offer.

This is deliberately narrower than generic legal/footer language. A normal received/recorded order remains parseable when it does not explicitly deny acceptance/contract formation.

Known merchant-specific adapters keep their separately reviewed semantics. For example, the exact JatekBolt order-received adapter remains available before the generic hard-negative gate.

### Quoted-history guard

Only the generic new-order parser receives a fresh-content view of the body. It removes or stops before recognized historical quote forms including:
- `On ... wrote:`
- Hungarian Gmail `... ezt írta:`
- `-----Original Message-----`
- `-----Eredeti üzenet-----`
- forwarded-message separators
- clear quoted `From/Feladó` + `To/Címzett` + `Subject/Tárgy` header blocks
- lines prefixed with `>`

The original full email is not globally modified. Other merchant/lifecycle parsers can continue using the complete message. A genuine fresh order above an older quoted support thread remains eligible for generic parsing.

## Live production-shadow diagnostics

The existing Gate B live observer also evaluates whether the already-fetched Nylas message truly falls through the central deterministic parser to the generic order-confirmation parser.

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
- raw sender address/domain
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

After v1.4 unit/CI verification, rerun the same rolling two-year read-only mailbox audit. The already reviewed unsafe disclaimer candidates and quoted-history duplicate should disappear, while the reviewed normal received/recorded order anchors should remain.

Only after a fresh mailbox audit and manual review should any narrower generic event be considered for a later promotion proposal. Automatic Purchase creation remains out of scope for this gate.
