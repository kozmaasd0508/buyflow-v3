# Magyar Posta Logisztika (MPL) — `1.0.0-test.1`

Status: **test / shadow only**  
Protocol ID: `carrier.hu.mpl`  
Country: HU

This profile models direct Magyar Posta / MPL recipient notifications. It is deliberately isolated from the production registry and cannot change live BuyFlow purchases or shipment state.

## Identity boundary

Direct MPL authority requires all of the following carrier identity evidence:

- sender domain: `posta.hu`
- exact sender: `kozponti.ertesites@posta.hu`
- DKIM domain: exactly `posta.hu`

Observed raw MIME also showed SPF and DMARC pass and `smtpN.posta.hu` delivery hosts, but transport host is not required by this first profile version.

Messages relayed by a marketplace or other intermediary are not direct MPL authority even if their visible copy resembles a Posta template. In particular, an observed Allegro relay using `allegromail.com` is intentionally rejected by this profile.

## Observed template evolution

The mailbox contains both older and newer official recipient templates. The profile treats them as equivalent only where their meaning is explicit.

Older posting notification:

- subject: `Csomagküldemény`
- label: `Küldeményazonosító`
- explicit text that a parcel was posted to the recipient

Newer posting notification:

- subject: `Csomagot adtak fel neked`
- label: `Csomagazonosító`
- same direct Posta sender and authenticated infrastructure

The same old/new variation appears around delivery-day wording (`Csomagja...` versus `Csomagod...`).

## Lifecycle mapping

### `SHIPMENT_CREATED`

Accepted examples:

- `Csomagküldemény`
- `Csomagot adtak fel neked`

Required evidence includes:

- authenticated MPL identity
- explicit posting wording
- parcel identifier
- `Feladás dátuma`

Safety boundary:

- **not `SHIPPED`**
- does not set `shipped_at`
- not `IN_TRANSIT`
- not `DELIVERED`

Magyar Posta documentation calls this a recipient posting/acceptance notification. BuyFlow keeps it at `SHIPMENT_CREATED` because this email does not need to manufacture a separate physical handoff timestamp.

### `OUT_FOR_DELIVERY`

Accepted subjects:

- `Csomagja a kézbesítőnél van`
- `Csomagod a kézbesítőnél van`

Observed direct carrier evidence includes either:

- explicit statement that the courier took the parcel and will attempt delivery that day, or
- the newer direct statement that the parcel is with the courier, often with an expected arrival window and courier phone number.

This is direct MPL evidence and therefore outranks a merchant-side logistics status.

### `DELIVERY_FAILED`

Subject:

- `Sikertelen kézbesítés`

The body must explicitly state that the courier was unsuccessful in delivering the parcel and include the parcel identifier.

Important safety rule: a failed delivery is **not** automatically `READY_FOR_PICKUP`. Observed MPL copy says a later notification will identify when/where the parcel can actually be collected.

### `READY_FOR_PICKUP`

Accepted observed subjects:

- `Csomagja érkezett`
- `Csomagod a postán átvehető`

Required evidence includes:

- explicit statement that the parcel is available at a post office
- `Átvétel helye`
- parcel identifier

This state is never `DELIVERED` merely because the parcel has reached a Posta/PostaPont/collection location.

Magyar Posta also documents parcel-locker arrival and pickup notifications. The official flow separates **arrival / available for collection** from **actual pickup confirmation**. No exact locker-pickup recipient template from this mailbox was added in this version, so the profile does not invent one.

### `DELIVERED`

Observed subject:

- `Véleménye fontos számunkra!`

The subject alone is deliberately insufficient. The body must explicitly contain the equivalent of:

`A <küldeményazonosító> küldemény kézbesítése sikeresen megtörtént.`

Repeated real authenticated Posta emails used this wording before asking the recipient to complete a satisfaction survey. This provides direct carrier confirmation of completed home delivery.

A generic survey or feedback email without that explicit delivery-success statement must not become `DELIVERED`.

## Hard negatives

The shadow tests protect against:

- marketplace/Allegro relay mail pretending to carry direct MPL authority
- lookalike DKIM domains such as `posta.hu.attacker.example`
- generic `Véleménye fontos számunkra!` without explicit delivery success
- `Sikeres fizetés visszaigazolás` from the same Posta sender being mistaken for parcel lifecycle evidence
- early posting notifications becoming `SHIPPED`, `IN_TRANSIT` or `DELIVERED`
- failed delivery becoming pickup-ready before the separate pickup notification
- post-office availability becoming delivered

## Sanitized evidence

The source research used real recipient emails across multiple dates and multiple parcel journeys, including:

- old and new posting templates
- old and new courier-allocation templates
- unsuccessful delivery
- later post-office availability
- repeated explicit successful-delivery feedback messages
- authenticated raw MIME with `posta.hu` DKIM/SPF/DMARC evidence

No real recipient names, addresses, phone numbers, order IDs or parcel identifiers are committed to the profile or tests. Test fixtures use synthetic identifiers only.

## Authority rule

For physical logistics:

**direct authenticated carrier evidence > merchant status wording**

This means a merchant cannot promote an MPL shipment beyond the state directly supported by the carrier notification.

## Production boundary

This profile is `status: test` and is registered only in the test/shadow registry.

It does **not**:

- create a Purchase
- write live Shipment state
- set a live `shipped_at`
- activate any production protocol rule
- use AI
- require a database migration

Promotion to production requires a separate review after broader shadow evaluation and ingestion/header wiring validation.
