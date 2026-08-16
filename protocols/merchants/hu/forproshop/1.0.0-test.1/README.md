# Forproshop (Shoprenter) — 1.0.0-test.1

Status: `test` / shadow only.

## Observed identity

The inspected real customer emails were merchant-branded as Forproshop but used `info@sport8.hu` as the visible sender. The same emails were delivered through verified `mail6.smtp.shoprenter.hu` DKIM and return-path infrastructure.

This profile therefore requires the exact observed merchant sender identity together with Shoprenter platform evidence. It does not treat every `sport8.hu` email as Forproshop commerce mail.

## Enabled shadow events

### ORDER_CREATED

Requires:

- exact Forproshop/Sport8 sender identity
- verified `*.smtp.shoprenter.hu` infrastructure
- Forproshop order-confirmation subject
- rendered order confirmation structure
- explicit order identity

### OTHER — `Rendelése elkészült - szállítás folyamatban`

This status is intentionally **not** `SHIPPED`.

For the same observed purchase, a direct FOXPOST pre-advice arrived roughly two minutes earlier and explicitly stated that a parcel number had been created but the parcel had not yet been handed to FOXPOST.

The shadow candidate therefore carries prohibitions against setting shipped time, in-transit state or delivered state.

### OTHER — `Teljesítve`

This status is intentionally **not** `DELIVERED` and **not** `REFUNDED`.

A direct FOXPOST ready-for-pickup notification was observed earlier in the journey, but the merchant `Teljesítve` email itself contained no direct proof that the customer picked up the parcel or that the carrier completed delivery.

## Generalization boundary

The status meanings are specific to the observed Forproshop journey and are not exported as global Shoprenter lifecycle mappings.

Across four observed Shoprenter merchants, merchant-configured labels vary enough that label-only inference is unsafe. Direct carrier/payment/invoice evidence or separately verified merchant wording remains higher authority.

## Privacy and production safety

- no real order number is committed
- no real parcel number is committed
- no customer name, address, phone or email is committed
- profile status is `test`
- production registry remains unchanged
- no live writes
- no AI
- no database migration
