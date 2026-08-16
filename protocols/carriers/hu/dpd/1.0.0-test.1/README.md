# DPD Hungary carrier protocol — `1.0.0-test.1`

Status: **test / shadow only**

Protocol ID: `carrier.hu.dpd`

This profile captures direct recipient-side DPD Hungary parcel notifications. It is deliberately excluded from the production protocol registry and cannot write live BuyFlow lifecycle state.

## Evidence sources

The profile is based on repeated sanitized real emails observed in the connected mailbox plus current DPD Hungary recipient documentation.

Observed lifecycle families include:

- parcel preparation / pre-advice
- physical dispatch / pickup-day notification
- delivery-today notification
- explicit successful delivery
- recipient refusal and return to sender
- myDPD redirection confirmation as non-progress evidence
- DPD payment receipts and satisfaction surveys as hard negatives

Representative raw MIME verified:

- exact sender `noreply@dpd.hu`
- DKIM pass for `dpd.hu`
- SPF pass
- DMARC pass
- DPD-owned transport such as `srv5.dpd.hu`

Transport host is not used as the identity gate; exact sender plus DPD DKIM is required.

No private recipient name, address, phone number, real parcel number, PIN or private myDPD token is committed in tests.

## Critical finding: subject text is ambiguous

DPD is a particularly important case for BuyFlow because the phrase **`küldemény feladásáról` is not sufficient to prove physical carrier handoff**.

Two observed patterns exist:

1. A preparation/pre-advice email can use subject `Értesítés <id> küldemény feladásáról` while the body explicitly says:
   - the merchant only prepared the parcel
   - this is an `előértesítés`
   - the parcel has **not yet been physically handed to DPD**

2. A later merchant-qualified email can use subject `Értesítés <id> <merchant> küldemény feladásáról` and state that the merchant actually sent the parcel that day, with an expected next delivery date.

Therefore DPD lifecycle classification must use **body semantics**, not a subject dictionary.

## Identity boundary

A direct DPD lifecycle event requires:

- sender domain `dpd.hu`
- exact sender `noreply@dpd.hu`
- DKIM domain exactly `dpd.hu`
- 14-digit observed parcel identity
- event-specific subject plus explicit body evidence

Brand name, a tracking link or subject text alone is insufficient.

## Event semantics

### `SHIPMENT_CREATED`

Observed subjects include:

- `Értesítés <id> küldemény előkészítéséről`
- older: `Értesítés <id> küldemény feladásáról`

Required body meaning:

- merchant prepared the recipient parcel
- DPD explicitly identifies it as pre-advice
- DPD explicitly says the parcel has not yet been physically handed over

This is not `SHIPPED` and not `IN_TRANSIT`.

Prohibitions include:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`

### `SHIPPED`

Observed subject family:

`Értesítés <id> <merchant> küldemény feladásáról`

Required meaning:

- the direct DPD recipient notification says the merchant sent the parcel that day
- the parcel identity is present
- an expected delivery day is supplied

Current DPD Hungary Predict documentation independently states that on the parcel pickup day the recipient is emailed that the package has reached DPD and is informed about expected next-working-day delivery.

This is strong enough for `SHIPPED`, but BuyFlow still does **not** invent an exact `shipped_at` timestamp from the email timestamp.

### `OUT_FOR_DELIVERY`

Observed subject family:

`Értesítés <id> <merchant> küldemény mai kézbesítéséről`

Required body meaning:

- DPD explicitly says the courier took the parcel for delivery that day
- the parcel identity is present
- a one-hour expected delivery window is present

This maps to `OUT_FOR_DELIVERY`, never directly to `DELIVERED`.

### `DELIVERED`

Observed subject variants:

- `Értesítés <id> sikeres kézbesítéséről`
- `Értesítés <id> küldemény sikeres kézbesítéséről`

Required body meaning:

- the identified parcel is explicitly named
- DPD explicitly says it was successfully delivered that day

The satisfaction-survey content frequently included after this statement is not the delivery proof; the explicit successful-delivery sentence is.

### `RETURN`

Observed subject:

`Értesítés <id> küldemény elutasításáról`

Required body meaning:

- the recipient rejected the identified parcel
- DPD explicitly says it will be transported back to the sender

DPD's current FAQ independently states that after recipient refusal the parcel is turned back to the sender.

This maps to carrier return-to-sender `RETURN` but **never** implies a financial refund.

`DO_NOT_MARK_REFUNDED` is mandatory.

## Unsupported in this version

### `DELIVERY_FAILED`

No sufficiently strong direct recipient failed-delivery email was found in the researched mailbox during this pass.

DPD documentation confirms retry/failure flows exist, but `1.0.0-test.1` deliberately does not create a `DELIVERY_FAILED` email rule without a verified direct sample.

### `READY_FOR_PICKUP`

DPD supports Pickup points and parcel lockers, but no direct recipient ready-for-pickup email was found in the researched mailbox during this pass.

No `READY_FOR_PICKUP` rule is added yet.

## Non-lifecycle / hard-negative families

### myDPD redirect confirmation

Observed sender:

`noreply@dpdgroup.com`

Observed meaning:

- address/date/delivery preference modification succeeded

This is a configuration change, not proof of physical progress.

### DPD payment/card receipt

Observed senders include:

- `noreply@notif.dpd.hu`
- historical receipt mail from `noreply@dpd.hu`

These are DPD terminal/card transaction receipts. They are not proof that a webshop purchase payment succeeded and they do not prove parcel delivery.

### Satisfaction survey

Observed sender:

`velemeny@adat.dpd.hu`

A generic survey is not a lifecycle event. A delivered email from `noreply@dpd.hu` only becomes `DELIVERED` when its body contains the explicit successful-delivery sentence for the parcel.

## Authority rule

Direct authenticated DPD evidence outranks merchant-side shipping labels.

Examples:

- merchant says `feladva`, DPD pre-advice says physically not handed over -> only `SHIPMENT_CREATED`
- direct DPD pickup-day evidence -> `SHIPPED`
- direct DPD courier possession + one-hour window -> `OUT_FOR_DELIVERY`
- direct DPD successful-delivery sentence -> `DELIVERED`
- recipient refusal + explicit return-to-sender -> `RETURN`, never `REFUNDED`

## Production status

This profile is registered only in `test-registry.ts`.

The production registry remains intentionally empty until broader shadow evaluation and live-ingestion evidence wiring have been proven safe.
