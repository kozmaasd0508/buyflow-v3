# GymBeam Hungary merchant shadow profile — 1.0.0-test.1

Status: **test / shadow only**

This profile formalizes directly observed GymBeam recipient-email behavior and does not modify production protocol decisions.

## Verified mail channels

Two transaction generations were observed.

### Legacy order channel

- exact From: `info@rendeles.gymbeam.hu`
- DKIM: `rendeles.gymbeam.hu` pass
- SPF: pass
- DMARC: pass
- Return-Path / transport may use `service.gymbeam.com`

Observed uses include order-recording and a paid-order electronic-invoice notification.

### Current service channel

- exact From: `info@service.gymbeam.hu`
- DKIM: `service.gymbeam.hu` pass
- SPF: pass
- DMARC: pass
- third-party transactional transport may be used and is not treated as merchant identity

Observed uses include order processing, packing/pre-handoff, delivery delay and invoice-ready notifications.

## Mappings

### ORDER_CREATED

A verified legacy email explicitly says the identified order was successfully recorded in GymBeam's system and processing will begin soon.

Safe mapping:

`recorded successfully + future processing -> ORDER_CREATED`

This is the merchant purchase anchor. It does not claim shipment or payment.

### ORDER_PROCESSING

A verified current email uses the processing subject and says:

- the order was received;
- the identified order is already being prepared.

Safe mapping:

`received + already being prepared -> ORDER_PROCESSING`

It carries `DO_NOT_CREATE_PURCHASE` because it is lifecycle progress rather than a new-order creation message.

### SHIPMENT_CREATED — critical GymBeam trap

A verified 2026 email has a subject equivalent to **“your order is on the way”** and top copy saying it was sent.

However the decisive body text says that:

- the identified order was **packed**;
- it will **soon** get into the hands of Express One;
- a carrier tracking number is already available.

Therefore the safe mapping is:

`packed + future carrier handoff + tracking -> SHIPMENT_CREATED`

Not `SHIPPED`.

The event carries:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`

This is a high-value example of why subject wording must not override explicit body semantics.

### DELAYED

A verified current automated email says the carrier delivery is taking longer than usual and GymBeam is actively coordinating with the courier.

Safe mapping:

`explicit slower-than-usual carrier delivery + courier coordination -> DELAYED`

This is not `DELIVERY_FAILED` and not `DELIVERED`.

### PAYMENT_SUCCESS — lower merchant authority

A verified legacy email explicitly says GymBeam received the amount due for the identified order and the order is already paid.

Safe mapping:

`received amount due + order already paid -> PAYMENT_SUCCESS`

This remains **merchant payment authority**. A direct payment-provider message is stronger when available.

The newer invoice template merely saying that everything is paid is deliberately not enough for a separate payment-success event; V1 requires the stronger observed receipt-of-funds wording.

### INVOICE

Two verified recipient templates exist.

Current service template:

- subject says the invoice is ready;
- body explicitly identifies the invoice;
- body says it is the invoice for the purchase;
- order identity is present;
- invoice may be accessed through a link rather than an email attachment.

Legacy paid-order template:

- subject links the invoice to a specific order;
- body identifies the electronic invoice number and order number.

Both map to `INVOICE`.

An invoice must not create a purchase by itself.

## Identifier policy

V1 extracts identifiers only from contextual labels/phrases observed in the email family:

- 10-digit GymBeam order number around `számú rendelés`
- 20–30 digit carrier tracking identifier only around the explicit `számmal követheted a csomagot` wording
- 10–12 digit invoice number only around explicit `számú számla` wording

Bare numbers are not globally guessed as order, tracking or invoice IDs.

## Authority boundaries

### Logistics

GymBeam merchant evidence can prove preparation and merchant-observed delay, but direct carrier evidence remains stronger for:

- physical carrier possession
- in transit
- out for delivery
- delivery failure
- pickup readiness
- final delivery

Current GymBeam documentation lists Express One, GLS, Foxpost and other delivery/pickup options. Direct carrier protocols remain authoritative for their own physical lifecycle.

Official source:
- https://gymbeam.hu/content/kezbesites

### Payment

GymBeam merchant payment confirmation is lower authority than a direct authenticated payment-provider result.

Do not infer payment success from:

- order creation
- order processing
- shipment preparation
- invoice existence alone
- payment-method labels
- the current invoice template's general paid-state summary without the stronger receipt-of-funds wording

### Returns and refunds

Current GymBeam pages document a return flow within 30 days from delivery. Return initiation and actual refund are different events.

Official sources:
- https://gymbeam.hu/visszakuldes
- https://gymbeam.hu/content/kezbesites

Targeted mailbox searches found no sufficiently verified direct recipient template for:

- `RETURN`
- `REFUNDED`
- `CANCELLED`
- `PAYMENT_FAILED`
- `WARRANTY`

V1 therefore implements none of them.

## Hard negatives / regression coverage

Tests cover:

- production detector cannot see the GymBeam shadow profile;
- processing cannot become a new purchase;
- `úton van` / `elküldésre került` cannot become physical shipment when the body says future carrier handoff;
- subject-only or incomplete pre-handoff wording is insufficient;
- merchant delay is not delivery failure or final delivery;
- legacy paid invoice can yield both `PAYMENT_SUCCESS` and `INVOICE` because the same verified message proves both facts;
- current invoice paid-summary wording remains only `INVOICE`;
- wrong/lookalike DKIM is rejected;
- human support and Trustpilot/review channels do not inherit automated merchant lifecycle authority;
- invented cancellation/return/refund/failure/warranty/delivered wording remains unsupported without observed templates.

## Existing runtime parsers

BuyFlow already contains deterministic GymBeam-specific runtime handling from earlier work, including processing, packed-before-handoff, delay and historical recovery paths.

This Protocol Library profile is a source-backed shadow formalization and regression layer. It does **not** switch on new live writes or replace the existing runtime path.

## Production

The production registry remains empty.

Promotion requires stable live ingestion of the required sender/DKIM evidence and continued zero-tolerance hard-negative testing.
