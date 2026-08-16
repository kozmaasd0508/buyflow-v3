# AQUA Hungary merchant research profile

Status: **research only**

Protocol: `merchant.hu.aqua`
Version: `1.0.0-research.1`

## Why this is research-only

The connected Gmail mailbox contains no direct AQUA transactional recipient email. Multiple searches for AQUA/aqua.hu order, invoice, shipment, return and warranty traffic produced no direct merchant lifecycle sample. One third-party MilPay promotional message mentions aqua.hu, but it is not AQUA authority.

Current official AQUA documentation proves useful lifecycle boundaries, but not the exact recipient templates, sender address, DKIM domain, Return-Path or current production wording. AQUA also states that operation of aqua.hu changed owner/operator on 2025-11-10, so historical templates cannot safely be assumed current.

This profile therefore stays outside the normal test/shadow registry and can only be invoked explicitly in focused research tests.

## Proven boundaries

### 1. Order submission email is not necessarily final acceptance

AQUA's current `Hogyan tudok rendelni?` page says that after the customer sends the order, the customer receives an email informing them of the fact of the order. The same page says the order is considered confirmed only after feedback from an AQUA Webáruház employee.

Research mapping:

- first system acknowledgement -> `OTHER`
- never auto-create a purchase
- a later explicit AQUA acceptance is only a research `ORDER_CREATED` candidate until a direct recipient template is observed

### 2. Cart placement is not reservation

Current AQUA campaign terms say cart placement does not reserve the product. Products are reserved only after order finalization and confirmation.

Therefore cart/product/price content cannot prove `ORDER_CREATED`.

### 3. Delivery scheduling is not shipment authority

AQUA states that delivery date/time information is sent by email. This does not prove physical carrier possession.

No positive `SHIPMENT_CREATED`, `SHIPPED`, `IN_TRANSIT`, `READY_FOR_PICKUP` or `DELIVERED` rule is implemented without a direct recipient sample.

Current AQUA pages list carrier/pickup channels such as MPL, Express One, FOXPOST/Packeta and pickup/point options. Direct authenticated carrier evidence remains higher logistics authority.

### 4. Warranty certificate PDF is not a warranty claim

AQUA's current warranty page says a warranty certificate PDF is sent after parcel dispatch. That PDF documents warranty coverage for the purchased product; it does not prove that a warranty case has been opened.

Research mapping:

- warranty-certificate delivery -> `OTHER`
- no `WARRANTY` lifecycle event from certificate presence alone

A real warranty case is a separate process involving product return, inspection and repair/replacement/refund decisions.

### 5. Withdrawal confirmation is not physical return or refund

AQUA's online withdrawal page says the submitted withdrawal request is confirmed by email with the withdrawal data and timestamp.

Research mapping:

- withdrawal-form confirmation -> `OTHER`
- not `RETURN`
- never `REFUNDED`

Physical return and settled refund require later evidence.

### 6. Payment provider remains separate authority

Current AQUA pages state online card payments use the Saferpay gateway.

No AQUA merchant `PAYMENT_SUCCESS`, `PAYMENT_FAILED` or `PAYMENT_ACTION_REQUIRED` rule is implemented from merchant wording alone.

### 7. Invoice/proforma remains unsupported

AQUA documentation references normal invoicing and proforma-based advance transfer, but the connected mailbox contains no verified recipient invoice/proforma delivery template. No positive `INVOICE` parser or invoice-number extractor is added.

## Hard negatives

The research regressions explicitly protect against:

- initial order acknowledgement becoming an accepted purchase
- delivery-date/time wording becoming shipment/delivery state
- warranty-certificate PDF becoming a warranty claim
- withdrawal confirmation becoming RETURN/REFUNDED
- generic Saferpay wording becoming payment success
- third-party MilPay AQUA marketing becoming merchant authority
- guessed invoice, shipped, pickup-ready, delivered, refund or warranty templates
- aqua.hu lookalike domains

## Promotion requirements

Before this profile can become `status: test`, collect at least one current direct recipient sample for the relevant family and verify:

1. exact sender address
2. DKIM domain
3. SPF/DMARC and Return-Path where available
4. exact subject/body structure
5. identifier placement
6. positive and hard-negative examples
7. current post-2025-11-10 template behavior

Production registry must remain unchanged until the normal promotion review is completed.
