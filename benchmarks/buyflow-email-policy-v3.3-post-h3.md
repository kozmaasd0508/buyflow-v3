# BuyFlow email policy v3.3 — post-H3 review resolution

Status: policy freeze for post-H3 tuning/regression only. H3 is spent after these decisions; future headline accuracy must use a fresh blind set.

Baseline: prompt v3.2 commit `2eacf018ff6c7d2eef306a2449f1e76bb689f249`, MailLens `normalized-email-document-v1.1`.

## Decision order

1. Run deterministic input-quality gate before any model call.
2. Determine perspective/scope.
3. Determine the newest current state that is already true now.
4. Extract explicit buyer-side IDs and their roles.
5. Determine link_status.
6. Run final consistency checks.

## Deterministic input-quality gate

If `semantic_text` contains only a generic email-client HTML fallback and no meaningful commerce state, do not call the model. Route to `REVIEW_INPUT_INCOMPLETE`, allow no lifecycle write, and require better body extraction/re-hydration before classification.

Canonical example pattern: `This is a HTML email and your email client software does not support HTML email!`

This is an input-quality decision, not an `event_type`.

## Event schema

Allowed event_type values:

`ORDER_CREATED`, `ORDER_PROCESSING`, `PAYMENT`, `INVOICE`, `SHIPMENT_CREATED`, `SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `DELIVERED`, `DELAYED`, `CANCELLED`, `REFUNDED`, `RETURN`, `OTHER`.

`DELAYED` is restored as a first-class event when a concrete order/shipment is explicitly delayed or a later ETA is explicitly announced.

## Perspective

- `buyer`: mailbox owner is customer/recipient side.
- `merchant_outbound`: mailbox owner acts as seller/shipper/merchant partner and the message concerns pickup, fulfillment, delivery, COD settlement or other merchant-side logistics/payment flow.
- `non_purchase`: survey, review request, marketing, security, preference, account-admin or other non-purchase content.
- Carrier pickup FROM the mailbox owner/sender is `merchant_outbound`.
- A carrier/payment message addressed to the mailbox owner as partner/merchant and confirming COD receipt/settlement is `PAYMENT + merchant_outbound`.
- `merchant_outbound` => buyer-side order/tracking IDs are null and `link_status=not_applicable`.
- `non_purchase` => `OTHER + null IDs + not_applicable`.

## Current-state rules

- `ORDER_CREATED`: buyer order received/accepted; no later processing state.
- `ORDER_PROCESSING`: buyer order is being prepared/processed; no shipment/pre-advice state yet.
- `SHIPMENT_CREATED`: tracking/pre-advice exists, or parcel is packed/waiting for carrier, but physical carrier handoff has not happened.
- `SHIPPED`: completed posting/sending/physical carrier acceptance is directly asserted, with no stronger later carrier-network state.
- If a message directly says the parcel was just posted/sent and also uses generic language such as `on the way`, keep `SHIPPED` unless it separately asserts concrete carrier-network processing/movement.
- `IN_TRANSIT`: concrete carrier-network movement or carrier-hub processing after physical acceptance. Example: collected from partner/locker and now moving to carrier warehouse/depot.
- `OUT_FOR_DELIVERY`: assigned to today's final-mile courier/vehicle.
- `READY_FOR_PICKUP`: physically at pickup point/locker and available.
- `DELIVERED`: recipient handoff completed.
- `DELAYED`: concrete shipment/order delay or explicitly moved-later ETA.
- `REFUNDED`: money actually returned/completed.
- `RETURN`: returned parcel physically received by merchant/returns warehouse.
- Future/planned events are not current states.

## Informational tracking notices

A dynamic-tracking invitation that only says tracking is available / ETA is continuously refreshed, but does not directly assert a lifecycle state, is not evidence for `SHIPMENT_CREATED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, etc.

Classify such a message as:

- `event_type=OTHER`
- `perspective=buyer`
- extract an explicit tracking_id if clearly present in carrier tracking
- `link_status=unresolved` when only the tracking ID is available

This is a no-lifecycle-change informational event, not `non_purchase`.

## Subscription/account-admin boundary

If a subscription cancellation is only future-dated, service is still active, and the message is account-management/admin rather than a completed commerce lifecycle event, classify as `OTHER + non_purchase + null IDs + not_applicable`.

## ID roles

- `order_id` only when explicitly identified as buyer order number/order ID.
- `tracking_id` only when explicitly identified as shipment/tracking/parcel/waybill ID or clearly used in carrier tracking.
- Ignore invoice/document/transaction/authorization/product/coupon/generic reference IDs unless explicitly buyer order/tracking IDs.
- Same literal may populate both only if explicitly used as both roles.
- Do not invent IDs.

## Linking

- `linked`: exact buyer order ID exists for this event, or explicit exact order-to-tracking relation exists.
- `unresolved`: buyer-side event/informational tracking item exists but no exact purchase link is available.
- `not_applicable`: merchant_outbound or non_purchase.

## H3 review resolutions

- H3-009: `PAYMENT / merchant_outbound / null / null / not_applicable`.
- H3-013: `OTHER / buyer / null / 3396938822 / unresolved`.
- H3-027: `OTHER / buyer / null / 3382964736 / unresolved`.
- H3-048: `SHIPPED / buyer / null / Z3502850057 / unresolved`.
- H3-057: `OTHER / buyer / null / 3398658635 / unresolved`.
- H3-058: deterministic `REVIEW_INPUT_INCOMPLETE`; no model call; no lifecycle write.
- H3-072: `OTHER / non_purchase / null / null / not_applicable`.
- H3-078: `OTHER / buyer / null / 3391050994 / unresolved`.
- H3-083: `DELAYED / buyer / null / Z3502850057 / unresolved`.
- H3-086: `OTHER / buyer / null / 3382490409 / unresolved`.
- H3-100: `PAYMENT / merchant_outbound / null / null / not_applicable`.

## Benchmark discipline

H3 was blind only for v3.2. After this policy resolution it is spent/tuning data. Any v3.3 run on H3 is regression evidence only and must never be reported as fresh blind production accuracy. Production remains OFF; O3 remains untouched.