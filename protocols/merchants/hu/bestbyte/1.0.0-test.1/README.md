# BestByte Hungary merchant shadow profile — 1.0.0-test.1

Status: `test` / shadow only

Protocol ID: `merchant.hu.bestbyte`

Production eligibility: **false**

## Scope

V1 is intentionally narrow. In the connected Gmail mailbox, the only directly observed BestByte recipient email family is electronic invoice delivery from `noreply@bestbyte.hu`.

Observed purchases sold by BestByte through fizz.hu demonstrate why authority boundaries matter:

- fizz.hu owns the marketplace order/lifecycle wrapper emails;
- BestByte directly issues the seller invoice;
- GLS / Express One directly own parcel lifecycle evidence.

V1 must never collapse those channels into one generic “BestByte order email” parser.

## Observed direct BestByte invoice

Representative sanitized structure:

- From: `BestByte Kft. <noreply@bestbyte.hu>`
- Subject: `Elektronikus számla - <DOCUMENT_ID>`
- Body explicitly says `<DOCUMENT_ID> bizonylatszámmal új elektronikus számla készült`
- Body says the electronic invoice and related hash code are attached
- Attachments:
  - `<DOCUMENT_ID>.PDF`
  - `HASH_<DOCUMENT_ID>.TXT`

Observed authentication/infrastructure:

- exact Return-Path: `noreply@bestbyte.hu`
- SPF: pass for `noreply@bestbyte.hu`
- DMARC: pass for `bestbyte.hu`
- observed transport host: `noreply.bestbyte.smtp.hu`
- **no BestByte DKIM signature was observed** on the representative message

Therefore V1 does not invent or require DKIM.

## Implemented event

### `INVOICE`

Requires all of:

1. exact sender `noreply@bestbyte.hu`
2. Return-Path domain `bestbyte.hu`
3. exact BestByte electronic-invoice subject family
4. explicit body wording that a new electronic invoice was created under a bizonylatszám
5. explicit body wording about invoice + hash-code attachments
6. invoice-shaped `<ID>.PDF` attachment
7. `HASH_<ID>.TXT` attachment

Extracted identifier:

- `invoice_id` only

Never infer from this email:

- `order_id`
- `payment_reference`
- `PAYMENT_SUCCESS`
- `ORDER_CREATED`
- `REFUNDED`

Prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_MARK_REFUNDED`

## Marketplace boundary: fizz.hu

Observed fizz.hu orders sold by BestByte contain:

- fizz order ID
- fizz order-created / shipment lifecycle wrapper
- a fizz invoice-wrapper email attaching a BestByte-issued invoice

These messages are from `noreply@fizz.hu`, not BestByte. Naming `Bestbyte Kft.` as seller/issuer does not make them direct BestByte merchant authority.

## Carrier boundary

Observed GLS and Express One messages name BestByte as sender/partner while independently proving shipment lifecycle.

Direct carrier evidence remains higher logistics authority than merchant or marketplace wording.

## Officially documented but intentionally unsupported in V1

BestByte's current public documentation describes:

- automatic order-arrival acknowledgement;
- that the acknowledgement is not acceptance of the customer's offer;
- store / warehouse pickup;
- home delivery and parcel-point / locker fulfilment;
- return initiation;
- later crediting/refund after returned goods are received.

These semantics are useful for safety boundaries but do **not** justify inventing recipient email templates.

Therefore V1 has no positive rule for:

- `ORDER_CREATED`
- `ORDER_PROCESSING`
- `ORDER_PACKING`
- `SHIPMENT_CREATED`
- `SHIPPED`
- `READY_FOR_PICKUP`
- `DELIVERED`
- `CANCELLED`
- `RETURN`
- `REFUNDED`
- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `WARRANTY`

## Hard negatives

Regression coverage ensures that the following do not become direct BestByte merchant evidence:

- fizz.hu order email naming BestByte as seller
- fizz.hu invoice wrapper naming BestByte as issuer
- GLS message naming BestByte as sender
- Express One message naming BestByte as sender
- subject-only fake BestByte invoice
- wrong Return-Path / lookalike sender
- synthetic order-receipt wording derived only from documentation
- return/refund/delivery/cancellation wording without an observed direct template

## Sources

Observed real recipient emails are represented only as sanitized structural fingerprints. No private customer data is stored in this profile.

Official documentation:

- https://www.bestbyte.hu/altalanos-szerzodesi-feltetelek-jaszf.html
- https://www.bestbyte.hu/fizetesi-es-szallitasi-informacio-hSZALLITAS.html
- https://www.bestbyte.hu/visszakuld-hVISSZAKULD.html
- https://www.bestbyte.hu/-hGYIK.html

## Safety status

This profile lives only in the test/shadow registry.

The production registry remains empty.
