# FOXPOST carrier — 1.0.0-test.1

Status: `test` / shadow only.

## Purpose

This is the first direct-carrier authority profile in the BuyFlow Protocol Library. It is based on repeated real FOXPOST recipient notifications observed across many merchants and dates, plus current FOXPOST customer documentation.

Direct carrier evidence outranks merchant-side status labels for physical parcel progress.

## Identity gate

A lifecycle event requires all of the following:

- sender domain `foxpost.hu`
- exact sender `no-reply@foxpost.hu`
- DKIM domain exactly `foxpost.hu`
- event-specific subject and body evidence

Observed raw MIME showed DKIM and DMARC passing for `foxpost.hu`. Mailjet was present as transport infrastructure, but Mailjet is deliberately not treated as FOXPOST identity.

## Supported lifecycle

### `Előértesítés` -> `SHIPMENT_CREATED`

Required evidence includes:

- FOXPOST says a parcel number was created
- explicit text says the parcel has **not yet been handed to FOXPOST**
- a `CLFOX...` parcel identifier is present

Safety:

- do not create a Purchase
- do not set `shipped_at`
- do not mark `IN_TRANSIT`
- do not mark `DELIVERED`

### `Csomagod már a raktárunkban van` -> `IN_TRANSIT`

FOXPOST itself confirms warehouse possession, which is stronger logistics evidence than a merchant saying `Elküldve`, `Szállítás alatt`, or similar.

The event still must not invent an exact historical `shipped_at` timestamp from the warehouse-arrival timestamp.

### `Csomagod megérkezett` -> `READY_FOR_PICKUP`

Required evidence includes:

- direct FOXPOST identity
- explicit text that the parcel has arrived and is available for pickup
- locker identity
- `CLFOX...` parcel identity

This event is **not `DELIVERED`**. The recipient has only been told that the parcel can be collected.

FOXPOST's current public pickup documentation also describes the arrival email as the notification sent when the parcel is placed in the selected locker and can be collected.

## Not enabled

`DELIVERED` is intentionally not implemented in this profile because this research pass did not find a separate, stable recipient email proving actual locker pickup.

Likewise, feedback/survey mail from FOXPOST must not become a parcel event.

## Cross-source authority rule

For physical logistics:

1. direct carrier evidence is authoritative
2. merchant status wording may provide context
3. ambiguous merchant labels must not override a direct carrier state

Example established by observed data:

- merchant: `Rendelése elkészült - szállítás folyamatban`
- direct FOXPOST: parcel number exists but parcel has **not** yet been handed over

The direct carrier evidence wins, so the state is at most `SHIPMENT_CREATED`, not `SHIPPED`.

## Privacy and production safety

- no real customer names, addresses, phone numbers or parcel IDs are stored in fixtures
- profile remains `status: test`
- production registry remains unchanged
- no live Purchase/Shipment writes
- no AI inference
