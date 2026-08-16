# GLS Hungary carrier protocol — 1.0.0-test.1

Status: **test / shadow only**

Protocol id: `carrier.hu.gls`

This profile is built from repeated sanitized recipient emails observed in Gmail plus current official GLS Hungary documentation. It is intentionally not registered in the production protocol registry.

## Carrier identity

Observed lifecycle messages consistently used:

- visible sender: `noreply@gls-hungary.com`
- sender domain: `gls-hungary.com`
- DKIM: `gls-hungary.com`
- DMARC: pass for `gls-hungary.com`
- GLS-owned transport hosts such as `mgw01.gls-hungary.com`, `mgw02.gls-hungary.com`, and `ws12.gls-hungary.com` were observed, but transport host is not required because the signed GLS domain is the stronger identity boundary.

A lookalike sender or DKIM domain must not qualify.

## Safe lifecycle mapping

| Direct GLS notification | BuyFlow shadow event | Why |
|---|---|---|
| `GLS csomag információ / GLS parcel information` | `SHIPMENT_CREATED` | GLS says its partner prepared the parcel and delivery is conditional on later dispatch/arrival. This does not prove GLS physical possession. |
| `GLS Átadópont csomaginformáció / GLS DeliveryPoints parcel information` | `SHIPMENT_CREATED` | Same pre-advice boundary for pickup-point flows. |
| `GLS <10 digits> mai kézbesítése / GLS <10 digits> delivery today` | `OUT_FOR_DELIVERY` | Direct GLS email says delivery will be attempted that day and provides a delivery window. |
| `Értesítés a <10 digits> számú csomag GLS Automatába helyezéséről` | `READY_FOR_PICKUP` | GLS explicitly says the parcel is in the locker and provides pickup credentials/deadline. It is not evidence that the recipient already collected it. |
| `Utánvétes fizetés visszaigazolás` + explicit locker-pickup wording + `paymentReceipt_<parcel>.pdf` | `DELIVERED` | This narrow email states the parcel was already taken out of the GLS locker. The receipt attachment also carries the parcel id. |

## Critical safety boundaries

### Parcel information is not SHIPPED

Observed parcel-information emails say that the GLS partner has prepared parcel(s) and that GLS will attempt delivery on the working day after dispatch/arrival. Some versions explicitly condition the date on the partner dispatching the parcel that day.

Therefore these emails are only `SHIPMENT_CREATED` and carry:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`

### Delivery today is not DELIVERED

The morning notification means the parcel is scheduled for a delivery attempt that day. It does not prove that the attempt succeeded.

Therefore it is `OUT_FOR_DELIVERY` and carries `DO_NOT_MARK_DELIVERED`.

### Locker placement is not DELIVERED

Observed GLS Automata emails provide an opening code/QR code and a pickup deadline. GLS official documentation also describes email/SMS/Viber notification when the parcel becomes available for pickup.

Therefore locker placement is `READY_FOR_PICKUP`, never `DELIVERED`.

### Narrow delivered proof for COD locker pickup

Repeated observed `Utánvétes fizetés visszaigazolás` emails say that the attached document is the receipt for the COD amount of a parcel already taken out from a GLS parcel locker. The attachment uses the form `paymentReceipt_<10-digit parcel>.pdf`.

Only that combined evidence qualifies for `DELIVERED` in this version. The profile does **not** generalize this into a universal GLS delivery-complete rule, and it does not create a generic `PAYMENT_SUCCESS` mapping; payment semantics remain a separate research layer.

## Hard negatives

Authenticated GLS mail can also be non-lifecycle traffic. Examples observed include:

- `GLS elégedettségi kérdőív`
- `Dinamikus csomagkövetés - GLS`

These subjects do not produce lifecycle events in this profile by themselves.

## Parcel identity

Observed Hungarian GLS recipient emails use a ten-digit parcel number. The shadow profile can extract it from:

- `Csomagszám:` in the email body
- `GLS <parcel> mai kézbesítése` subject
- GLS Automata placement subject
- `paymentReceipt_<parcel>.pdf` attachment filename

No merchant order id is inferred from GLS emails.

## Official documentation used

- GLS Hungary services / FlexDeliveryService: `https://gls-group.com/HU/en/business-customer/how-to-ship-with-gls/services/`
- GLS Hungary Parcel Lockers: `https://gls-group.com/HU/en/gls-points/parcel-lockers/`
- GLS Hungary FAQ: `https://gls-group.com/HU/en/faq/`

The official service description states that recipients can receive an early notification when goods are ready to be shipped, then a second message on the delivery morning containing a three-hour delivery window, and another notification after an unsuccessful first attempt. The locker documentation describes notification when a parcel is available for pickup and PIN/QR-code collection.

## Production status

This profile remains `status: test` and is registered only in `test-registry.ts`.

It does not:

- modify live Purchase or Shipment records
- create purchases
- set live `shipped_at`
- enter the production protocol registry
- use AI

Promotion to production requires a separate decision after broader regression coverage, ingestion-header availability verification, and cross-carrier conflict tests.
