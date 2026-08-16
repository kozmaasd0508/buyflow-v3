# Euronics Hungary merchant protocol — 1.0.0-test.1

Status: **test / shadow only**

Production registry: **unchanged and empty**

## Scope

This profile is intentionally narrow. It is based on directly observed recipient emails from:

- `ugyfelszolgalat@euronics.hu`
- authenticated with DKIM `euronics.hu`
- Mandrill transport / bounce infrastructure

The same sender also sends account-access mail, so sender identity alone is not lifecycle evidence.

## Directly observed positive lifecycle

### ORDER_CREATED

Observed subject shape:

`A(z) NNNNNNNN számú rendelésedet fogadtuk!`

Required structure includes:

- `Rendelésed rögzítettük.`
- `Rendelésed feldolgozását megkezdtük.`
- explicit `Rendelés azonosító: NNNNNNNN`

The same message says Euronics will send another notification when the product is handed to the carrier. Therefore the initial email is not SHIPPED.

An observed order used online credit and explicitly said delivery was expected after successful credit approval. The order therefore exists before financing is finally approved.

### CANCELLED

Observed subject shape:

`A(z) NNNNNNNN számú rendelésed töröltük`

Observed body explicitly states the identified order was cancelled because the credit application review ended with a negative result.

This maps to `CANCELLED` only.

It does **not** prove:

- `PAYMENT_FAILED`
- `PAYMENT_SUCCESS`
- `REFUNDED`

A negative financing/credit decision is not the same event as a declined card transaction.

## Authentication

Representative order and cancellation raw MIME showed:

- DKIM pass for `euronics.hu`
- secondary DKIM pass for `mandrillapp.com`
- SPF pass on a Mandrill bounce Return-Path
- DMARC pass for `euronics.hu`

Mandrill is transport infrastructure and not the semantic identity boundary.

V1 requires:

- exact sender `ugyfelszolgalat@euronics.hu`
- exact DKIM domain `euronics.hu`

## Hard negatives

### One-time account login

The same sender sends `Egyszeri belépésre jogosító link` messages with passwordless login links. This maps to `OTHER` and must never create or auto-link a purchase.

### Generic `30 napos elállás`

The Euronics email chrome/footer can contain `30 napos elállás` even on ordinary order, cancellation and account messages.

Therefore the phrase alone must never produce:

- `RETURN`
- `REFUNDED`

### Financing cancellation is not payment failure

The observed cancellation is caused by negative credit assessment. V1 deliberately does not convert this to `PAYMENT_FAILED`.

## Officially documented but unsupported recipient templates

Current Euronics documentation states that:

- online orders receive automatic email status updates;
- parcel dispatch is communicated by email;
- store-pickup orders are emailed once ready for pickup;
- withdrawal submission has a confirmation flow;
- online credit proceeds to delivery after successful approval and contract conclusion.

Sources:

- https://euronics.hu/gyakori-kerdesek
- https://euronics.hu/szallitasi-informaciok
- https://euronics.hu/online-aruhitel
- https://euronics.hu/elallas
- https://euronics.hu/static/aszf

These documents describe process semantics, not exact recipient email templates. Without directly observed messages V1 intentionally does **not** add positive rules for:

- `SHIPMENT_CREATED`
- `SHIPPED`
- `READY_FOR_PICKUP`
- `DELIVERED`
- `INVOICE`
- `RETURN`
- `REFUNDED`
- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `WARRANTY`

## Authority boundaries

Direct carrier evidence remains stronger than merchant wording for physical logistics.

Direct payment/financing-provider evidence remains stronger than merchant wording for payment state.

A future Euronics invoice sample must be researched independently before invoice identifiers or document rules are added.

## Safety invariants

- production detector cannot see this profile;
- exact authenticated sender is required;
- subject-only matching is insufficient;
- login/account email cannot create a purchase;
- footer withdrawal wording cannot create RETURN;
- negative credit review cannot create PAYMENT_FAILED;
- officially documented but unobserved email families remain unsupported.
