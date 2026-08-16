# Express One Hungary carrier protocol — `1.0.0-test.1`

Status: **test / shadow only**

Protocol ID: `carrier.hu.expressone`

This profile captures direct recipient-side Express One Hungary parcel notifications. It does not write live BuyFlow lifecycle state and is intentionally excluded from the production protocol registry.

## Evidence sources

The profile is based on repeated sanitized real recipient emails observed in the connected mailbox plus current Express One Hungary documentation:

- Express One recipient notification service documentation
- Express One tracking/notification flow documentation describing DLS and OFD notifications
- Express One eBox FAQ distinguishing sender-side pickup notifications from recipient delivery notifications
- repeated real `ertesites@expressone.hu` recipient emails
- raw MIME verification of `expressone.hu` DKIM/SPF/DMARC on representative pre-advice, delivery-today and delivered messages

No private recipient name, address, telephone number, real shipment number or private tracking token is stored in this protocol fixture set.

## Identity boundary

A lifecycle event requires:

- sender domain `expressone.hu`
- exact recipient-notification sender `ertesites@expressone.hu`
- DKIM domain exactly `expressone.hu`
- event-specific subject and explicit body semantics

Branding or subject text alone is insufficient.

### Important sender-side hard negative

`no-reply@expressone.hu` is used for sender/eBox **árufelvétel** booking notifications such as:

- booking recorded
- courier accepted the pickup job
- pickup expected in a two-hour window

Those messages describe the account holder acting as **shipper**, not a recipient-side purchase delivery. They are deliberately excluded from `carrier.hu.expressone`.

The following Express One addresses are also outside this recipient-lifecycle profile:

- `slip@expressone.hu` — payment receipts
- `ertekesites@expressone.hu` — partner/service announcements
- `info@expressone.hu` — newsletters/general mail

## Event semantics

### `SHIPMENT_CREATED`

Observed subject:

`Előzetes értesítés csomag érkezéséről`

Required meaning:

- the merchant notified Express One about a parcel intended for the recipient
- a shipment number exists
- Express One explicitly says the parcel **has not yet been handed over to the courier service**

Therefore this event is deliberately not `SHIPPED` or `IN_TRANSIT`.

Prohibitions include:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`

### `IN_TRANSIT`

Observed subject:

`Küldemény feldolgozása megkezdődött`

Required meaning:

- Express One says processing started in the central warehouse
- the email explicitly states `fizikálisan érkeztettük`
- the shipment number is present

This is direct carrier-possession evidence and is therefore safe to classify as `IN_TRANSIT`.

It does not imply recipient delivery.

### `OUT_FOR_DELIVERY`

Observed subject:

`Csomag kézbesítés ma – ETA és módosítás`

Required meaning:

- the courier has taken the shipment for delivery that day
- a shipment number is present
- Express One provides a narrowed two-hour ETA window

This maps to `OUT_FOR_DELIVERY`, never directly to `DELIVERED`.

### `DELAYED`

Observed subject family:

`Késik a kézbesítés – új ETA: ...`

Required meaning:

- the identified shipment was not delivered within the previously announced ETA window
- Express One records the delay
- a revised expected delivery time is supplied or the delay itself is explicitly recorded

This is `DELAYED`, **not** `DELIVERY_FAILED`. The observed message still expects later delivery.

### `DELIVERED`

Observed subject:

`Küldemény kézbesítve – kérdőív`

The survey-like subject alone is not enough.

Required meaning:

- the identified shipment is named
- Express One explicitly states that it `átadásra került` at a concrete timestamp
- delivery/POD information is available through Express One tracking

Only this explicit body evidence promotes to `DELIVERED`.

## Unsupported in this version

### `DELIVERY_FAILED`

Express One documentation confirms unsuccessful-delivery states exist in its system, but no direct recipient-side failed-delivery email was found in the researched mailbox during this pass.

For that reason `1.0.0-test.1` deliberately contains **no `DELIVERY_FAILED` rule**. BuyFlow must not invent the event from documentation or merchant wording alone.

### `READY_FOR_PICKUP`

Express One supports parcel shops and parcel lockers, but no sufficiently strong recipient-ready-for-pickup email sample was verified in this research pass. No rule is added yet.

## Authority rule

Direct authenticated `ertesites@expressone.hu` lifecycle evidence outranks merchant wording about physical parcel progress.

Examples:

- merchant says `úton van`, Express One pre-advice says not yet handed over -> only `SHIPMENT_CREATED`
- Express One central warehouse says physical inbound completed -> `IN_TRANSIT`
- Express One courier takes it for same-day delivery -> `OUT_FOR_DELIVERY`
- revised ETA after missed window -> `DELAYED`
- explicit handover timestamp + POD link -> `DELIVERED`

## Hard-negative coverage

Regression tests cover:

- pre-advice without the explicit not-handed-over sentence
- sender-side `no-reply@expressone.hu` pickup bookings
- `slip@expressone.hu` payment receipts
- lookalike DKIM domains
- delivered/questionnaire subject without explicit delivery body evidence
- production detector isolation

## Production status

This profile is registered only in `test-registry.ts`.

The production registry remains intentionally empty until broader real-world shadow evaluation and ingestion wiring are completed.
