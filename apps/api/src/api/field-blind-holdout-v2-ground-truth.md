# Blind Field Holdout v2 — Ground Truth Freeze

Status: FROZEN BEFORE FIRST MOTOR RUN
Mode: SHADOW · 0 WRITE · 0 AI

Ground truth below was derived from the original Gmail message bodies, never from BuyFlow parser output. Unknown/unproven fields are `not_asserted`. Do not edit these expectations after the first motor run; corrections require a new version and audit note.

## Commerce ground truth (6)

### 19feb646e0160ca7 — FNP Products
- eventType: `shipment`
- merchant: `FNP Products`
- orderNumber: `46789`
- total: `9560`
- currency: `HUF`
- carrier: `Express One`
- trackingNumber: `not_asserted`
- paymentStatus: `cash_on_delivery`
- products: `[{"name":"Hidrolizált Kollagén Italpor Hialuronsavval MANGO ízben","quantity":1}]`
- evidence: message says order 46789 was handed to the courier; final total 9 560 Ft; TOURMIX & Express One delivery; cash on delivery.

### 19feaf982b637504 — GymBeam
- eventType: `invoice_or_receipt`
- merchant: `GymBeam`
- orderNumber: `3010354660`
- total: `not_asserted`
- currency: `not_asserted`
- carrier: `not_asserted`
- trackingNumber: `not_asserted`
- paymentStatus: `paid`
- products: `not_asserted`
- invoiceNumber (audit note, outside current scorer): `4008987362`
- evidence: invoice for order 3010354660 is ready; invoice number 4008987362; message explicitly says everything is paid.

### 19fd5e309b403641 — DPD delivered
- eventType: `delivery`
- merchant: `not_asserted`
- orderNumber: `not_asserted`
- total: `not_asserted`
- currency: `not_asserted`
- carrier: `DPD`
- trackingNumber: `13169408547018`
- paymentStatus: `not_asserted`
- products: `not_asserted`
- evidence: DPD message explicitly states shipment 13169408547018 was successfully delivered.

### 19fce434814a5ebf — Díjnet payment
- eventType: `payment_completed`
- merchant: `Díjnet`
- orderNumber: `not_asserted`
- total: `14705`
- currency: `HUF`
- carrier: `not_asserted`
- trackingNumber: `not_asserted`
- paymentStatus: `paid`
- products: `not_asserted`
- evidence: Díjnet explicitly states the bank-card transaction was successful; transaction total is 14 705 Ft. Two underlying TRV invoices (7 327 + 7 378 Ft) sum to the transaction total but are not treated as order numbers.

### 19fcc8874f657138 — Gyerekjatekbolt.com payment
- eventType: `payment_completed`
- merchant: `Gyerekjatekbolt.com`
- orderNumber: `536066`
- total: `14960`
- currency: `not_asserted`
- carrier: `not_asserted`
- trackingNumber: `not_asserted`
- paymentStatus: `paid`
- products: `not_asserted`
- evidence: message explicitly says order 536066 was successfully paid; transaction accepted; amount 14960. No currency token is present in the source, therefore currency is not asserted.

### 19fc7bb6c2fcb815 — DPD preparation
- eventType: `shipment`
- merchant: `MODELL&HOBBY Kft.`
- orderNumber: `not_asserted`
- total: `not_asserted`
- currency: `not_asserted`
- carrier: `DPD`
- trackingNumber: `16380124260338`
- paymentStatus: `not_asserted`
- products: `not_asserted`
- evidence: DPD pre-notification names MODELL&HOBBY Kft. as sender and explicitly lists package number 16380124260338; parcel has not yet physically been handed to DPD.

## Hard noise (10)

The following message IDs are frozen as non-commerce detection truth:
- 1a01e5a22617a76d
- 1a01b363800e92d0
- 1a0123667ed47ccf
- 1a009fd96cc7eb43
- 19ffa16e809a4a47
- 19ff28a9a5531c8a
- 19fdb8a6f954adb4
- 19fd1ff082a80067
- 19fce5cf24baf31e
- 19fca841993ae749

## Scoring contract

Detection truth is frozen by the Commerce/Hard noise lists above. Current scored fields: eventType, merchant, orderNumber, total, currency, carrier, trackingNumber, paymentStatus, products. `not_asserted` fields do not contribute to field accuracy. A parser-produced value for a not_asserted field must not be retroactively promoted into ground truth.

## Anti-overfitting rule

No parser/detector modification is allowed between this freeze and recording the first Blind v2 result. The first result is permanent baseline evidence. Blind v1 fixtures may be used only as regression tests, never as evidence for v2 generalization.
