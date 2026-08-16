# Gyerekjatekbolt.com / Shoprenter — 1.0.0-test.1

Status: **test / shadow only**

This profile is based on sanitized fingerprints from real customer emails observed on 2026-08-16. No customer name, address, phone number, real order number, message id or transaction id is stored in this repository.

## Scope

This is deliberately a **merchant-specific** profile. Shoprenter lets merchants configure visible sender details, templates and order statuses, so these Gyerekjatekbolt semantics must not be generalized to all Shoprenter stores.

The shadow profile requires three layers of agreement:

1. exact Gyerekjatekbolt merchant identity (`gyerekjatekbolt.com` and the observed sender address),
2. verified Shoprenter mail infrastructure (`*.smtp.shoprenter.hu` DKIM and return-path),
3. explicit event wording plus stable order identity.

## Observed lifecycle

### PAYMENT_SUCCESS

Observed message explicitly states that the numbered order was successfully paid and includes transaction acceptance evidence (`Válaszkód: 00` + `Tranzakció elfogadva`).

Safety:
- status text alone is insufficient,
- must not create a Purchase,
- direct payment-provider evidence remains higher authority than merchant wording.

### SHIPPED

Observed status-change message contains both:
- merchant status `Szállítás alatt`, and
- explicit physical handoff wording: the order was handed to the courier.

Safety:
- `Szállítás alatt` alone is not enough,
- must not create a Purchase,
- must never be promoted to DELIVERED from this email.

### DELIVERED

Observed status-change message explicitly states `Rendelés kézbesítve` for the numbered order.

Safety:
- this is merchant-side delivery evidence,
- direct carrier delivery evidence remains higher authority,
- test status prevents production eligibility or live state writes.

## Hard boundaries

- Another Shoprenter merchant cannot inherit these mappings merely because it uses the same platform infrastructure.
- Lookalike DKIM/return-path domains are rejected.
- No generic Shoprenter status dictionary is introduced.
- No AI, database migration, Purchase write, Shipment write or production registry activation is included.

## Promotion blockers

Before any production promotion:
- collect more real Gyerekjatekbolt samples across multiple orders,
- verify the same infrastructure and wording remain stable,
- compare shadow results against direct carrier/payment evidence,
- retain zero false Purchase creation and zero unsafe delivered/refunded promotion in the safety benchmarks.
