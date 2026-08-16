# Alza Hungary merchant protocol — 1.0.0-test.1

Status: **test / shadow only**

Protocol ID: `merchant.hu.alza`

Production registry: **unchanged**

## Scope

This profile is derived from multiple directly observed recipient emails from `segito@alza.hu`, representative raw MIME authentication checks, and current official Alza Hungary documentation.

It is deliberately conservative. It does not treat generic subject words, marketing mail, legal/process documentation, or API/account concepts as lifecycle proof.

## Authority

Observed direct lifecycle channel:

- sender address: `segito@alza.hu`
- sender domain: `alza.hu`
- DKIM: `alza.hu`
- SPF: pass for `segito@alza.hu`
- DMARC: pass for `alza.hu`
- Return-Path: `segito@alza.hu`
- observed transport: `smtpout*.alza.cz`

Transport is infrastructure, not identity.

A critical hard negative is that the same authenticated `segito@alza.hu` + `alza.hu` DKIM channel also sends AlzaPlus promotional email. Sender authentication is necessary but never sufficient.

## Supported shadow events

### ORDER_CREATED

Observed subject family:

`Köszönjük 595825244 sz. megrendelésed`

Required semantics:

- `Megrendelésed rendben megkaptuk`
- the message explicitly states that the message itself has **not yet formed a contract**

This is still `ORDER_CREATED` because BuyFlow uses the event for order receipt/creation, not legal contract formation.

### ORDER_PROCESSING

Observed subject family:

`Már dolgozunk rajta. / 595825244 sz. megr.`

Required semantics:

- `megrendelésed feldolgozását megkezdtük`
- customer is told to wait for the next SMS/email

This is **not SHIPPED** and does not establish carrier possession.

### PAYMENT_ACTION_REQUIRED

Observed bank-transfer family:

`Köszönjük a megrendelést, már csak a fizetés van hátra / 594687258 sz. megr.`

Required semantics:

- concrete HUF amount requested
- explicit instruction to transfer the amount

This is payment action required, not a failed or successful payment transaction.

### CANCELLED

Observed subject family:

`Információ a(z) 594687258 sz. megrendelésről`

Required semantics:

- `A megrendelés törölve`
- `mivel nem lett kifizetve`

The event is `CANCELLED` only. A missing payment is not evidence that a card/bank transaction failed, so no `PAYMENT_FAILED` is created.

### SHIPPED — observed DPD variant only

Observed subject family:

`593968900 sz. megrendelésed épp most küldtük el.`

Required semantics:

- explicit `Megrendelésed átadtuk a szállítónak`
- carrier is DPD
- 14-digit DPD parcel number in tracking URL

Direct DPD evidence remains higher logistics authority for later movement, delivery attempts and final delivery.

### DELAYED

Observed subject family:

`602385238 sz. megrendelésed késve érkezik`

Required semantics:

- explicit apology for delay
- explicit new expected delivery time

A revised ETA is `DELAYED`, not `DELIVERY_FAILED`.

### READY_FOR_PICKUP — AlzaBox

Observed subject family:

`Vedd át 602385238 sz. megrendelésed`

Required semantics:

- explicit AlzaBox pickup instruction
- order explicitly arrived at a named AlzaBox
- pickup code section present

The observed message can still show a payable amount and an online payment button. Therefore:

- AlzaBox arrival = `READY_FOR_PICKUP`
- AlzaBox arrival ≠ `DELIVERED`
- unpaid amount / payment button ≠ `PAYMENT_SUCCESS`

### INVOICE — conservative later-stage rule

Observed later lifecycle messages contain:

- `Számla letöltése`
- an Alza PDF-document link such as `.../Apps/pdfdoc.asp?d=AHUW...`
- explicit wording that Alza accepted the order and the contract was formed

Important hard negative:

An earlier `ORDER_PROCESSING` email can already contain the same-looking `Számla letöltése` link while explicitly saying the contract has **not** yet formed.

Therefore `Számla letöltése` alone is not enough for V1 `INVOICE`. The later explicit acceptance/contract-formation wording is required as an additional gate.

The `AHUW...` document token is not globally promoted to canonical `invoice_id` because current evidence does not prove that it is always the legal invoice number rather than an internal document identifier.

### OTHER — return request only

Observed subject family:

`Az AVRA26957208 sz. reklamációt befogadtuk`

Required semantics:

- `Küldd el nekünk a terméket`
- return/claim case identifier exists
- instructions describe how the customer can send the product

This is intentionally `OTHER`, not `RETURN`, because physical return has not occurred yet.

### RETURN — physical receipt of withdrawal item

Observed subject family:

`Vonatkozó információk: AVRA26957208`

Required semantics:

- `A terméket reklamációra átvettük`
- case type is `Elállás`

This is the first observed point where the product is explicitly in Alza's possession, so V1 maps it to `RETURN`.

The observed message exposes an `AVRA...` claim identifier but no direct order number. The current protocol identifier schema has no `claim_id` field, therefore this V1 event includes `DO_NOT_AUTO_LINK`.

### REFUNDED

Observed subject:

`Pénzt küldünk vissza számodra.`

Required semantics:

- `Visszatérítettünk ... Ft-ot`
- `A bankkártyádra visszautaltunk ... Ft-ot`
- linked withdrawal case

The bank may still take up to several business days to show the credit, but the merchant explicitly states the refund transfer has been sent. This is materially stronger than refund eligibility, a planned refund, or a return request.

The observed refund message also contains a downloadable accounting-document link. It is **not** treated as a fresh `INVOICE` event because the conservative invoice rule additionally requires the later order-acceptance/contract-formation wording.

## Identifier handling

V1 extracts only directly proven identifiers that fit the current protocol schema:

- `order_id`: 9-digit Alza order identifier from explicit `Megrendelés ...` structure or observed Alza order URLs
- `tracking_id`: 14-digit DPD parcel number from `parcelNumber=` in the observed DPD handoff template
- `invoice_id`: deliberately `null`
- `payment_reference`: deliberately `null`

`AVRA...` is a return/claim identifier, but the current protocol schema has no claim identifier field. V1 does not force it into order, invoice, tracking or payment identity.

## Hard-negative boundaries

The tests explicitly guard these mistakes:

- authenticated AlzaPlus marketing ≠ purchase lifecycle
- `ORDER_PROCESSING` ≠ `SHIPPED`
- early `Számla letöltése` link ≠ final `INVOICE`
- payment request ≠ `PAYMENT_FAILED`
- unpaid cancellation ≠ failed transaction
- AlzaBox ready ≠ `DELIVERED`
- AlzaBox ready with amount due ≠ `PAYMENT_SUCCESS`
- return request/instructions ≠ physical `RETURN`
- physical `RETURN` ≠ `REFUNDED`
- generic refund wording ≠ `REFUNDED`
- subject-only lifecycle wording ≠ event
- wrong DKIM ≠ trusted Alza authority
- generic delivered, payment-failed or warranty wording without captured template remains unsupported

## Unsupported in V1

No positive rule is implemented for:

- `PAYMENT_SUCCESS`
- `PAYMENT_FAILED`
- `IN_TRANSIT`
- `OUT_FOR_DELIVERY`
- `DELIVERED`
- `DELIVERY_FAILED`
- `WARRANTY`

These remain unsupported until a sufficiently verified direct recipient template is captured.

## Official documentation used

Current Alza Hungary documentation corroborates the boundaries without being treated as an email template:

- `https://www.alza.hu/hogyan-vasarolj`
- `https://www.alza.hu/alzabox`
- `https://www.alza.hu/fizetesi-modok-art14905.htm`
- `https://www.alza.hu/szerviz-szolgaltatasainkhogy-semmire-zakuldesenek-menete-art12601.htm`
- `https://m.alza.hu/kapcsolat`

Official documentation is process evidence only. Positive recipient-email rules still require observed direct-message structure.
