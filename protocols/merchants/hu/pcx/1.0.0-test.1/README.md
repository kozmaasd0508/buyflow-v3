# PCX Hungary merchant shadow profile — 1.0.0-test.1

Status: **test / shadow only**

This profile formalizes a directly observed PCX recipient-email lifecycle and does not modify production protocol decisions.

## Verified mail channel

Observed direct transactional channel:

- exact From: `vevoszolgalat@pcx.hu`
- sender domain: `pcx.hu`
- DKIM: `pcx.hu` pass
- SPF: pass
- DMARC: pass
- Return-Path: direct PCX sender
- observed transport: `smtp01.vhost.hu`

Transport infrastructure is not treated as merchant identity. V1 requires the exact sender plus `pcx.hu` DKIM.

## Directly observed same-order lifecycle

A single PCX order was observed across three separate recipient emails with the same `YYMMDD/######` order identifier.

### ORDER_CREATED

Observed subject family:

`Rendelés - YYMMDD/######`

The email contains the full order summary and says PCX will begin processing the order. Later courier handoff is described as a future action.

Safe mapping:

`authenticated order-received email + contextual PCX order id + future processing -> ORDER_CREATED`

General footer/legal text about withdrawal, return rights or future delivery does not create lifecycle events.

### ORDER_PACKING

Observed subject:

`Hamarosan összeállítjuk a rendelésedet`

The body says the identified order will soon start being assembled.

Safe mapping:

`future assembly -> ORDER_PACKING`

This is not shipment creation and not carrier possession. The event carries:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`

### SHIPPED

Observed subject:

`DPD csomagod érkezik, a számlát csatoltuk`

The body explicitly states that the order was handed over for delivery and contains:

- the PCX order identifier;
- a 14-digit `Csomag azonosító`;
- expected next-business-day arrival;
- invoice and warranty-document information.

Safe mapping:

`explicit handoff for delivery + order id + parcel id -> SHIPPED`

The expected arrival date is future information and must not become `DELIVERED`.

Direct DPD email remains the stronger authority for later physical lifecycle such as movement, delivery attempt/failure and successful delivery.

Official PCX delivery documentation confirms that PCX sends an email on the handoff day and the carrier separately communicates delivery information:

- https://www.pcx.hu/rendelesi_informaciok
- https://www.pcx.hu/szallitas

## Invoice and warranty documents

The observed handoff email contains two PDF attachments with different document semantics.

### Invoice PDF

Observed filename family:

`POB######-YYYY.pdf`

The verified document itself is explicitly headed `SZÁMLA` and contains:

- canonical `Sorszám` in `POB######/YYYY` form;
- PCX order number;
- payment method;
- completion and invoice dates;
- invoice totals;
- a `FIZETVE` mark in the observed example.

Safe mapping:

`explicit invoice-attached wording + POB######-YYYY.pdf -> INVOICE`

The current Protocol Library receives attachment filenames but not extracted PDF text. The canonical invoice number uses `/` inside the PDF while the filename uses `-`. V1 deliberately leaves `invoice_id` null rather than pretending the filename-safe token is the canonical document number.

The `FIZETVE` mark is not turned into a separate merchant `PAYMENT_SUCCESS` event. Direct payment-provider evidence remains stronger, and no verified standalone PCX payment-confirmation email was found.

### Warranty PDF

The second observed PDF is explicitly titled `Garancialap` and contains:

- PCX order identity;
- products and serial numbers where applicable;
- warranty periods;
- purchase value fields;
- warranty terms.

It also contains invoice-like wording such as `Számlaérték`.

Critical hard negative:

`Garancialap + Számlaérték != INVOICE`

Document type wins over isolated vocabulary.

Receiving a warranty sheet documents warranty coverage for the purchase; it does **not** prove that a warranty claim has started. V1 therefore does not emit `WARRANTY` from the purchase attachment alone.

PCX has a separate warranty/repair flow:

- https://www.pcx.hu/garancia

## Payment trap in the shipment email

The observed DPD handoff email contains conditional instructions for some locker/card-payment situations, equivalent to:

`after successful card payment, DPD sends the PIN`

This is future/conditional instructional wording. It is **not** proof that the current order produced a `PAYMENT_SUCCESS` event.

## Post-purchase review hard negative

A separate authenticated PCX email asks how previously purchased products work and requests a review.

A review request may reference the order and proves purchase history, but it does not prove the parcel was delivered at that moment.

Safe mapping:

`review request -> OTHER`

with `DO_NOT_MARK_DELIVERED`.

## Unsupported V1 states

Targeted mailbox searches did not produce sufficiently verified direct recipient templates for:

- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `CANCELLED`
- `RETURN`
- `REFUNDED`
- warranty-claim `WARRANTY`
- `READY_FOR_PICKUP`
- `DELIVERY_FAILED`
- `DELIVERED`

V1 implements none of these from invented wording.

## Identifier policy

V1 extracts only directly contextualized identifiers:

- PCX order id: `YYMMDD/######`
- DPD parcel id: 14 digits after `Csomag azonosító:`

The canonical invoice number is intentionally not extracted until PDF text/document metadata is available to the live detector.

## Authority boundaries

- direct carrier > PCX merchant for logistics after physical handoff;
- direct payment provider > PCX merchant/invoice status for payment;
- explicit invoice attachment/document type > generic invoice-like vocabulary;
- warranty document existence != warranty claim lifecycle.

## Production

The production registry remains empty.

This profile is test/shadow only. Promotion requires stable live ingestion of sender/DKIM evidence and continued hard-negative evaluation with near-zero false positives.
