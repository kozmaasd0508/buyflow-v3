# Packeta Hungary carrier protocol — `1.0.0-test.1`

Status: **test / shadow only**

Protocol ID: `carrier.hu.packeta`

This profile captures authenticated recipient-side Packeta notification mail in Hungary, including the 2026 legal/brand transition where the visible sender became `FoxPost Kft.` while the technical channel remained `noreply@packeta.hu` with `packeta.hu` DKIM.

## 2026 Hungary transition boundary

Packeta documents that Packeta Hungary Kft. merged into FoxPost Kft. on 2026-01-01. During 2026 the former Packeta Z-BOX network was progressively moved into the FOXPOST network and became FOXPOST Z-BOX.

Therefore BuyFlow must not treat every Packeta-branded or FOXPOST-branded message as the same carrier event source. This profile identifies the authenticated Packeta technical channel, not the display name.

Required identity:

- sender domain `packeta.hu`
- exact sender `noreply@packeta.hu`
- DKIM domain exactly `packeta.hu`
- event-specific subject and explicit body semantics

Observed raw MIME also showed `mg.packeta.hu`, Mailgun transport, SPF pass and DMARC pass. Third-party transport is not sufficient identity by itself.

## `SHIPPED`

Observed subject:

`A szállítmányt elfogadták a szállításra`

The subject alone is insufficient.

Required body evidence must explicitly say either:

- the sender has now sent the recipient's parcel, or
- the webshop handed the identified Packeta shipment/order to the network,

and must also state the delivery route, such as:

- Z-BOX delivery
- selected Packeta pickup point
- onward delivery by a contractual carrier

Current Packeta documentation independently states that after the webshop prepares the parcel it hands it to the network, after which Packeta processes it and sends the parcel/tracking information.

This event is `SHIPPED`, but the notification timestamp is not automatically written as `shipped_at`.

## `READY_FOR_PICKUP`

Observed primary subject:

`A csomag készen áll átvételre`

Two direct recipient variants were verified:

- Z-BOX: the parcel is ready for collection in the Z-BOX, with opening code/instructions
- staffed Packeta pickup point: the parcel is ready at the named pickup location, with collection password and deadline

Both map to `READY_FOR_PICKUP`, never `DELIVERED`.

An observed reminder used:

`Megjegyzés: A szállítmány kézbesítésre kész`

Despite the word `kézbesítés`, the body explicitly said the parcel was **still waiting in the Z-BOX for the recipient to collect it**. That reminder is also only `READY_FOR_PICKUP`.

## Payment hard negative

Observed subject:

`Visszaigazolás az online kártyás fizetéshez`

The email confirms online payment of the parcel COD amount, but also says the parcel might still not be collected and could later be returned.

Therefore in this carrier phase it is not:

- `DELIVERED`
- `RETURN`
- a purchase-creation event

Payment-provider/payment semantics are intentionally handled in the later payment research layer.

## Unsupported in this version

### `DELIVERED`

No separate authenticated recipient email proving actual Packeta/Z-BOX pickup was found in the researched mailbox. No DELIVERED rule is added.

### `RETURN`

Observed non-collection wording was conditional future text such as a parcel being returned if it is not collected. That is not proof that a return has actually started.

### `OUT_FOR_DELIVERY`

For observed home-delivery journeys, Packeta acceptance mail stated that a contractual carrier would perform the final delivery. Later physical states should come from that downstream carrier's own authenticated evidence.

## Packeta → FOXPOST handoff lesson

A real 2026 journey showed:

1. authenticated `noreply@packeta.hu` acceptance for the merchant parcel
2. later authenticated `no-reply@foxpost.hu` warehouse-arrival evidence for the same merchant

The Packeta email used a `Z...` identifier while the FOXPOST email used a different `CLFOX...` identifier.

BuyFlow must never fabricate an equality between those identifiers. Any cross-carrier link needs independent purchase/merchant/time evidence from the resolver layer.

## Hard-negative coverage

Regression tests cover:

- subject-only accepted-for-transport mail
- Z-BOX and staffed pickup-point variants
- `kézbesítésre kész` reminder staying pickup-ready
- COD payment confirmation not becoming delivery/return
- Mailroom account verification
- lookalike DKIM
- production-registry isolation
- same Packeta Z identifier progressing only from `SHIPPED` to `READY_FOR_PICKUP`

## Production status

This profile is registered only in `test-registry.ts`.

The production protocol registry remains intentionally empty. No live Purchase/Shipment writes, no AI, and no database migration are introduced by this profile.
