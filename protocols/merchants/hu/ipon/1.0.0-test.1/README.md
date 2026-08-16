# iPon Hungary merchant shadow profile

Protocol: `merchant.hu.ipon`  
Version: `1.0.0-test.1`  
Status: `test`  
Production eligible: **no**

## Purpose

This profile captures only directly observed recipient-email structures from iPon and keeps merchant evidence below direct carrier/payment authority.

The production protocol registry remains unchanged and empty.

## Observed authenticated channel

Representative order, parcel and invoice emails were sent from:

- `info@ipon.hu`
- DKIM: `ipon.hu` pass
- SPF: `info@ipon.hu` pass
- DMARC: `ipon.hu` pass
- Return-Path: `info@ipon.hu`
- observed transport: `gw195.ipon.hu`

Transport hosts are infrastructure, not semantic authority.

The same authenticated channel also sends abandoned-cart reminders and product-review requests, so sender identity alone is never enough.

## Supported events

### ORDER_CREATED

Observed subject:

`iPon - Rendelés #<7-digit-order-id>`

Required evidence includes:

- exact sender and DKIM gate
- explicit order-recorded wording
- explicit order identifier
- the observed legal/semantic boundary saying the current order is not an offer by iPon

The event means BuyFlow has observed a recorded order. It does not prove payment, shipment or delivery.

### ORDER_PROCESSING

Observed later order-status emails can use the same subject but say the products will be handed to the courier on a future date or after assembly.

This is pre-handoff fulfilment only.

It must never set:

- `SHIPPED`
- `IN_TRANSIT`
- `DELIVERED`

### SHIPMENT_CREATED

Observed subject:

`Csomagfeladás #<order-id>`

Despite the subject, the body says:

- the parcel **will be handed over today** to the courier
- a parcel number is already assigned
- tracking will become available only later

A direct GLS pre-advice with the same parcel number arrived minutes later and still described the merchant-prepared parcel flow. Therefore V1 maps this merchant email to `SHIPMENT_CREATED`, not `SHIPPED`.

Observed carrier families include GLS and SZAMI Group. Direct carrier evidence remains higher authority.

### INVOICE

Observed subject:

`Számla YYYY/######`

Required evidence includes:

- exact sender and DKIM gate
- explicit body saying invoice + warranty sheet + withdrawal information are attached
- invoice attachment matching `YYYY-######-invoice-<internal>.pdf`

The canonical invoice id is extracted from the subject as `YYYY/######`.

The separate `<internal>-guarantee.pdf` attachment is warranty documentation, not a warranty-claim lifecycle event.

### OTHER hard negatives

Observed examples:

- `Kosár emlékeztető`
- `Termékek véleményezése`

These can contain products, prices, and post-purchase language but must not create purchases or final delivery states.

## Payment boundary

Current iPon documentation says booked bank transfers trigger an automatic notification, but no verified recipient template for that automated notification was found in the mailbox.

A named iPon finance employee manually replied that a transfer arrived. That human reply is intentionally **not** generalized into `PAYMENT_SUCCESS`.

Current iPon payment documentation also separates bank transfer/proforma, SimplePay, Saferpay and financing methods. Direct provider evidence remains a separate authority layer.

## Return / warranty boundary

Observed human support replies explain how withdrawal can be requested. They do not prove:

- that a product was physically returned
- that iPon received it
- that a refund was settled

Current iPon warranty documentation defines a separate GaranciaFutár / warranty-claim flow and requires invoice/warranty documentation for claim handling. Receiving those documents with a purchase does not mean a warranty claim has started.

## Intentionally unsupported in V1

No positive rule is implemented for:

- `SHIPPED`
- `IN_TRANSIT`
- `OUT_FOR_DELIVERY`
- `READY_FOR_PICKUP`
- `DELIVERED`
- `DELIVERY_FAILED`
- `DELAYED`
- `CANCELLED`
- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `PAYMENT_ACTION_REQUIRED`
- `RETURN`
- `REFUNDED`
- `WARRANTY`

These require a verified direct recipient template rather than documentation-only inference or free-form human support text.

## Official references

- iPon Frequently Asked Questions: `https://ipon.hu/gyakori-kerdesek`
- iPon Payment Methods: `https://ipon.hu/fizetesi-modok`
- iPon Pickup / Delivery Methods: `https://ipon.hu/atveteli-modok`
- iPon Warranty / GaranciaFutár: `https://ipon.hu/garancia`

## Safety principles

- subject `Csomagfeladás` alone does not mean physical `SHIPPED`
- parcel number existence alone does not mean carrier possession
- cart product + price does not mean a purchase exists
- review request does not prove delivery
- invoice email does not prove payment success
- warranty attachment does not prove warranty claim
- withdrawal instructions do not prove return receipt
- human finance/support replies are not generalized into global automated templates
- production registry remains empty
