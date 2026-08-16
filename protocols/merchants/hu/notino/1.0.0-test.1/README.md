# Notino Hungary merchant shadow profile — 1.0.0-test.1

Status: **test / shadow only**

This first Notino profile intentionally implements **no positive purchase lifecycle event**. The connected Gmail mailbox contains directly authenticated Notino mail, but targeted searches did not produce a sufficiently verified recipient order-confirmation, shipment, delivery, invoice, cancellation, return or settled-refund template.

V1 therefore focuses on a high-value abandoned-cart hard negative and documents official lifecycle boundaries without pretending those public descriptions are exact email templates.

## Verified authenticated channel

Observed direct Notino messages use:

- exact From: `info@notino.hu`
- DKIM: `notino.hu` pass
- SPF: pass from `ov.notino.hu`
- DMARC: pass for `notino.hu`
- Return-Path below `ov.notino.hu`
- Omnivery transport

Transport infrastructure is not treated as Notino identity. V1 requires exact `notino.hu` DKIM.

A crucial finding is that the exact same authenticated `info@notino.hu` channel also sends account-security messages such as password-change mail. Therefore sender identity alone is never enough to infer commerce lifecycle.

## Observed abandoned-cart structure

Multiple real recipient emails used:

- subject: `A kosárban Önre várnak a termékek`
- explicit text equivalent to `Kár lenne nem befejezni a megrendelést`
- a real-looking product name
- quantity
- VAT-inclusive price
- `order-reorder.asp` link
- links tagged with `utm_campaign=unfinished-order`
- call to action asking the recipient to order the selected product

This can look extremely similar to a real purchase record to a weak recognizer.

Safe mapping:

`authenticated unfinished cart -> OTHER`

Prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`
- `DO_NOT_MARK_REFUNDED`

A product name, quantity, price, VAT total or order/reorder URL does **not** prove a completed order.

## Official Notino lifecycle boundaries

### 1. Order submission / receipt confirmation is separate from shipment acceptance

Current Notino Hungary business terms state that an online order is a proposal for an agreement. Receipt of that proposal is acknowledged by email. The sales contract is formed later when Notino accepts the proposal by shipping the ordered goods, and Notino also sends an email about shipment.

Official source:
- https://www.notino.hu/uzleti-feltetelek/

BuyFlow consequence:

- public process documentation proves there are multiple order stages;
- do not collapse all `rendelés` mail into one universal positive template;
- no `ORDER_CREATED` parser is added until a direct recipient confirmation is captured and authenticated.

### 2. Warehouse preparation is not SHIPPED

Notino's shipping FAQ explicitly distinguishes two states:

- when the package is `készül`, it is being packed in the warehouse and prepared for dispatch;
- only when the package has been handed over for transport is it already with the carrier.

Official source:
- https://www.notino.hu/faqs/category/szallitas

BuyFlow consequence:

`packing / preparing for dispatch != SHIPPED`

This is the same safety boundary already learned from GymBeam, DPD and other merchants/carriers.

### 3. Physical handoff / shipment notification

Current Notino delivery documentation says customers are emailed when the parcel is sent / handed over and that parcel identity or tracking information is included. For Express One, Notino states that information including the parcel number is emailed at handoff.

Official sources:
- https://www.notino.hu/szallitas-es-fizetes/
- https://www.notino.hu/faqs/category/szallitas

This supports the lifecycle concept:

`verified physical handoff + parcel identity -> potential SHIPPED`

But V1 deliberately does **not** implement it because the mailbox research did not provide a direct authenticated recipient shipment template with exact subject/body structure.

Direct carrier evidence remains higher logistics authority.

### 4. Invoice can be coupled to shipment email

Current Notino business terms say the electronic tax document is sent electronically in the email concerning shipment.

Official source:
- https://www.notino.hu/uzleti-feltetelek/

This is important architecture information because one future Notino email may legitimately prove both:

- shipment evidence
- invoice existence

However V1 does not invent a combined `SHIPPED + INVOICE` rule without an observed recipient email.

### 5. Payment semantics are separate authority

Notino's current payment page says that when an online card transaction is authorized, payment becomes successful immediately.

Official source:
- https://www.notino.hu/szallitas-es-fizetes/

That public process rule does not reveal a verified recipient payment-email template. V1 therefore adds no `PAYMENT_SUCCESS`, `PAYMENT_FAILED` or `PAYMENT_ACTION_REQUIRED` Notino parser.

Direct payment-provider evidence remains stronger.

### 6. Return initiation is not settled refund

Notino currently offers withdrawal/return workflows. Its terms state that refund can be withheld until the goods are returned or the customer proves return.

Official sources:
- https://www.notino.hu/uzleti-feltetelek/
- https://www.notino.hu/faqs/category/reklamacio

Therefore:

- return request / withdrawal != `REFUNDED`
- item sent back != `REFUNDED`
- refund policy wording != `REFUNDED`
- only actual settled refund evidence may become `REFUNDED`

No direct recipient return/refund template was found in this research round.

## Hard negatives covered by tests

Regression tests verify that:

- production detector cannot see the Notino shadow profile;
- abandoned cart maps only to `OTHER`;
- concrete product, quantity and price cannot create a purchase;
- an `order-reorder.asp` link is not an order ID or completed order proof;
- subject alone is insufficient;
- unfinished-order copy without the real campaign/template evidence is insufficient;
- lookalike DKIM is rejected;
- password-change mail from the same authenticated sender is not commerce lifecycle;
- `newsletter@notino.hu` and `club@notino.hu` do not inherit merchant transaction authority;
- public-FAQ-like `package is being prepared` wording is not turned into `ORDER_PACKING` or `SHIPPED` without an observed recipient template;
- invented order confirmation, shipped, delivered, failed delivery, payment, invoice, return, refund and cancellation templates remain unsupported;
- return-policy wording never creates a settled refund.

## Unsupported lifecycle in V1

No positive rules exist for:

- `ORDER_CREATED`
- `ORDER_PROCESSING`
- `ORDER_PACKING`
- `SHIPMENT_CREATED`
- `SHIPPED`
- `IN_TRANSIT`
- `OUT_FOR_DELIVERY`
- `READY_FOR_PICKUP`
- `DELIVERED`
- `DELIVERY_FAILED`
- `DELAYED`
- `CANCELLED`
- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `INVOICE`
- `RETURN`
- `REFUNDED`
- `WARRANTY`

Missing is safer than guessed.

## Production

The production registry remains unchanged and empty.

This profile is available only through the test/shadow registry. Promotion requires directly captured recipient lifecycle templates plus sender/DKIM verification and hard-negative coverage.
