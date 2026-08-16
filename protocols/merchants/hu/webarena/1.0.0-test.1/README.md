# WebArena (Shoprenter) — 1.0.0-test.1

Status: `test` / shadow only. Not registered for production decisions or writes.

## Why this profile exists

Two real WebArena order journeys were inspected in the connected mailbox. The samples confirm both reusable Shoprenter infrastructure and merchant-specific status wording.

All stored fixtures are sanitized. No customer names, addresses, phone numbers, real order ids or other private identifiers are committed.

## Observed order confirmation

A real WebArena order confirmation used:

- visible merchant sender: `ugyfelszolgalat@webarena.hu`
- DKIM: `shoprenter.hu`
- return-path domain: `mail2.shoprenter.hu`
- Shoprenter-owned transport host
- rendered copy: `Megrendelése megérkezett, feldolgozása elkezdődött.`
- explicit `Rendelésszám`

This is a second verified Shoprenter delivery route. Earlier observed Shoprenter messages used `*.smtp.shoprenter.hu` DKIM/return-path infrastructure.

The generic `commerce.shoprenter` shadow profile therefore models the two verified routes separately. The visible merchant From-domain alone is never considered sufficient platform proof.

## Observed merchant lifecycle

### Elküldve

Observed on two separate WebArena orders.

The status emails contained:

- stable WebArena sender identity
- verified `*.smtp.shoprenter.hu` infrastructure
- explicit order id
- merchant status `Elküldve`

They did **not** contain:

- tracking id
- explicit courier pickup/handoff wording
- direct carrier evidence

Therefore the profile emits `OTHER` and prohibits:

- setting shipped_at
- marking IN_TRANSIT
- marking DELIVERED

`Elküldve` must not be generalized to `SHIPPED` across Shoprenter merchants.

### Teljesítve

Observed after `Elküldve` on one WebArena journey.

No direct carrier delivery evidence for that journey was found in the mailbox search. The status email itself only states the merchant-side label `Teljesítve`.

Therefore it remains `OTHER`; it must not automatically become `DELIVERED` or `REFUNDED`.

## Cross-merchant finding after three Shoprenter merchants

The growing evidence supports a useful split:

### Reasonably reusable platform evidence

- Shoprenter-owned DKIM/return-path/transport infrastructure
- rendered order-confirmation structure
- explicit order identity

### Not safely reusable without merchant-specific evidence

- status label semantics
- shipping progress semantics
- delivery semantics
- payment status labels

Examples already observed:

- Gyerekjatekbolt: `Szállítás alatt` was only promoted to SHIPPED when the body also explicitly said the order had been handed to the courier.
- Home Automatica: `FoxPost szállításra előkészítve` was only SHIPMENT_CREATED; direct FOXPOST evidence said the parcel had not yet been handed over.
- Home Automatica: `Jóváírás` followed a successful payment and was not a refund.
- WebArena: `Elküldve` and `Teljesítve` remain merchant-side `OTHER` without direct carrier evidence.

## Promotion blockers

Do not promote WebArena logistics status rules to production until direct carrier-linked samples or equivalent stronger evidence establish the exact physical meaning.

The generic Shoprenter order-confirmation detector also remains shadow-only while coverage across additional merchants and hard negatives grows.
