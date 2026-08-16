# Barion Hungary payment profile — 1.0.0-test.1

Status: **shadow/test only**  
Protocol ID: `payment.hu.barion`

## Purpose

This profile captures only payment facts that are directly supported by authenticated Barion recipient emails. It is deliberately narrower than Barion's API status model.

A Barion payment email is payment authority, not purchase authority. It must not create a BuyFlow purchase or be automatically attached to one without separate matching evidence.

## Authenticated sender boundary

Observed recipient success messages used both:

- `barion@barion.com`
- `noreply@barion.com`

Raw MIME from both generations showed `barion.com` DKIM pass and DMARC pass. Amazon SES transport was observed, but transport infrastructure is not used as provider identity.

The test profile therefore requires:

- sender domain `barion.com`
- one of the two observed exact sender addresses
- DKIM domain exactly `barion.com`

A display name, subject line, merchant mention of Barion, or lookalike DKIM domain is insufficient.

## PAYMENT_SUCCESS

Observed direct Barion success receipts consistently contained:

- subject `Sikeres fizetés`
- explicit text equivalent to `Sikeresen fizettél ... Ft-ot bankkártyával`
- `Fizetés Barion azonosítója:` followed by a 32-character hexadecimal Barion payment identifier
- merchant/acquirer context and card/payment details

Safe mapping:

`Sikeres fizetés` + authenticated Barion identity + explicit successful-payment sentence + Barion payment ID -> `PAYMENT_SUCCESS`

The Barion payment identifier is extracted as `payment_reference`.

### Prohibitions

Every Barion `PAYMENT_SUCCESS` evidence row carries:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_MARK_REFUNDED`

## Merchant order/reference field

Observed emails can contain:

`Rendelés elfogadóhelyen nyilvántartott azonosítója:`

The value is controlled by the accepting merchant and may also be `Nincs megadva`. V1 therefore does **not** extract it as a global BuyFlow `order_id`.

Any future linking based on this value must be merchant-specific and separately verified.

## Critical refund hard negative

The ordinary Barion **successful-payment** receipt itself contains customer-service text mentioning:

`Rendelés, szállítás vagy visszatérítés ...`

That wording merely tells the customer to contact the merchant for order, delivery or refund questions. It is **not refund evidence**.

Therefore:

- the word `visszatérítés` alone must never produce `REFUNDED`
- `Sikeres fizetés` remains `PAYMENT_SUCCESS` even when this support paragraph is present
- a direct, authenticated and explicit refund recipient template is required before a Barion `REFUNDED` email rule can be added

## Events deliberately not implemented

### PAYMENT_FAILED

Barion's API defines failed/cancelled/expired outcomes, but no authenticated failed-payment recipient email was found in the researched mailbox. API status semantics must not be converted into guessed email templates.

### PAYMENT_ACTION_REQUIRED

Barion supports asynchronous and reservation flows, including non-final payment states, but no authenticated recipient email representing a BuyFlow-safe action-required event was found.

### REFUNDED

Barion's API models refunds as separate refund transactions. Current Barion documentation also notes flows where the merchant, rather than Barion, is responsible for customer notification. No authenticated explicit refund recipient email was found in the researched mailbox.

For these reasons V1 contains no `PAYMENT_FAILED`, `PAYMENT_ACTION_REQUIRED`, or `REFUNDED` event.

## Official semantic corroboration

Current Barion documentation used for semantic boundaries:

- `https://docs.barion.com/PaymentStatus`
  - `Succeeded` is a completed final payment state.
  - `Canceled`, `Failed`, `Expired`, and other states are distinct outcomes.
- `https://docs.barion.com/Callback_mechanism`
  - payment changes are communicated to merchants through callbacks followed by PaymentState lookup.
  - refunds appear as separate refund-type transactions and do not change the original succeeded payment status.
- `https://docs.barion.com/Reservation_payment`
  - at least some reservation-finalization/refund scenarios explicitly do not trigger a Barion customer email; merchant notification is required instead.
- `https://docs.barion.com/Bank_Transfer_Payment`
  - `Waiting` is non-final and may still later become failed, illustrating why API states are not equivalent to recipient-email events.

## Regression coverage

The shadow suite verifies:

1. current `noreply@barion.com` success -> `PAYMENT_SUCCESS`
2. older `barion@barion.com` success -> `PAYMENT_SUCCESS`
3. production registry cannot see the test profile
4. Barion payment ID is extracted as `payment_reference`
5. merchant-owned order reference is not extracted as `order_id`
6. the generic `visszatérítés` support wording does not create `REFUNDED`
7. success subject alone is insufficient
8. lookalike DKIM is rejected
9. merchant-origin emails mentioning Barion are rejected as direct Barion authority
10. unapproved Barion sender addresses do not inherit payment authority
11. synthetic failed/pending/refund wording does not invent events that V1 has not verified

All test fixtures are synthetic and contain no private real transaction/customer identifiers.

## Production boundary

This profile is registered only in `test-registry.ts`.

It must not be added to the production registry until:

- authenticated header fields are reliably available in live ingestion,
- shadow precision is measured on real incoming mail,
- linking policy for payment evidence is separately validated,
- positive and hard-negative regression coverage remains green.
