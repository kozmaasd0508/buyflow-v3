# BuyFlow email policy v3.4 — pre-H4 freeze candidate

Purpose: generalize the post-H3 policy before any H4 email is selected or inspected. H3 is spent development/regression data. H4 will be a fresh blind comparison set for local AI vs Luna.

Baseline evidence used for this freeze:
- MailLens v1.1 / H3 input and V3.3 regression are spent evidence.
- H3 review decisions are development evidence only.
- No H4 content may be used to change this policy before both model predictions are frozen.

## Decision order

1. Deterministic input-quality gate.
2. Perspective/scope.
3. Newest current state already true now.
4. Explicit IDs and their roles.
5. link_status.
6. Final consistency check.

## Deterministic input-quality gate

If semantic input is empty or contains only a generic email-client fallback and no meaningful commerce state, route to `REVIEW_INPUT_INCOMPLETE`. Do not call a model and do not write lifecycle state.

MailLens must normalize mislabeled raw HTML carried in a provider plain-text field before this gate. Raw markup is not valid semantic model input.

## Event schema

Allowed event_type values:

`ORDER_CREATED`, `ORDER_PROCESSING`, `PAYMENT`, `INVOICE`, `SHIPMENT_CREATED`, `SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `DELIVERED`, `DELAYED`, `CANCELLED`, `REFUNDED`, `RETURN`, `OTHER`.

## Perspective

- `buyer`: mailbox owner is customer/recipient side.
- `merchant_outbound`: mailbox owner acts as seller/shipper/merchant partner and the message concerns pickup, fulfillment, delivery, COD settlement or other merchant-side logistics/payment flow.
- `non_purchase`: survey, review request, marketing, security, preference, account-admin or other non-purchase content.
- Carrier pickup FROM the mailbox owner/sender is `merchant_outbound`.
- Merchant COD receipt/settlement confirmation is `PAYMENT + merchant_outbound`.
- `merchant_outbound` => buyer-side order/tracking IDs null and `link_status=not_applicable`.
- `non_purchase` => `OTHER + null IDs + not_applicable`.

## Current state

- `ORDER_CREATED`: buyer order received/accepted; no later preparation, shipment or payment state is directly asserted.
- `ORDER_PROCESSING`: an existing buyer order is being prepared/processed, OR a future carrier handoff/shipping plan is explicitly announced but there is no current shipment/tracking/pre-advice evidence yet.
- `SHIPMENT_CREATED`: shipment/tracking/pre-advice exists, parcel is packed/waiting for carrier, or a merchant-outbound pickup/collection booking has been created/registered/accepted for future pickup; physical handoff has not yet happened.
- `SHIPPED`: completed posting/sending/dispatch/physical carrier acceptance is directly asserted, with no stronger later state. Merchant wording such as `sent`, `dispatched`, `elküldve`, `feladva`, or an explicit current statement that the order `is on the way` counts as SHIPPED when it describes the completed send state rather than a future plan. A tracking link becoming active later does not by itself downgrade a directly asserted completed send state.
- `IN_TRANSIT`: concrete carrier-network movement or carrier-hub processing after physical acceptance. Example: collected from partner/locker and now moving to carrier warehouse/depot.
- `OUT_FOR_DELIVERY`: assigned to today's final-mile courier/vehicle.
- `READY_FOR_PICKUP`: physically at pickup point/locker and available.
- `DELIVERED`: recipient handoff completed.
- `DELAYED`: a concrete order/shipment is explicitly delayed or its ETA is explicitly moved later. A current explicit delay takes precedence over generic SHIPPED/IN_TRANSIT wording in the same message unless the delay is explicitly stated as resolved.
- `REFUNDED`: money actually returned/completed.
- `RETURN`: returned parcel physically received by merchant/returns warehouse.
- Future/planned events are not current states.

## Merchant-outbound pickup rule

A carrier message to the mailbox owner as shipper/merchant that says a pickup/collection request was created, registered, booked or accepted for a future pickup is:

`SHIPMENT_CREATED + merchant_outbound + null + null + not_applicable`

Do not map this to `ORDER_CREATED`: it is a logistics booking, not a buyer purchase order.

## Informational tracking notices

A dynamic-tracking invitation that only says tracking is available or ETA is continuously refreshed, but does not directly assert a lifecycle state, is:

`OTHER + buyer + [explicit tracking_id if present] + unresolved`

It must not change the purchase lifecycle state.

## Subscription/account-admin boundary

A future-dated subscription cancellation while service remains active is account administration, not a completed commerce lifecycle state:

`OTHER + non_purchase + null + null + not_applicable`

## Payment identifiers

- A payment/authorization/transaction identifier is not an order_id.
- An identifier explicitly labeled as the merchant/store/acquirer-side order identifier for the buyer payment counts as `order_id`.
- Example role wording may include `merchant order ID`, `store order ID`, or equivalent local-language wording. The role, not the numeric shape, controls extraction.

## ID roles

- `order_id` only when explicitly identified as buyer order number/order ID or equivalent merchant-side order identifier for that buyer transaction.
- `tracking_id` only when explicitly identified as shipment/tracking/parcel/waybill ID or clearly used in carrier tracking.
- Ignore invoice/document/transaction/authorization/product/coupon/generic reference IDs unless explicitly buyer order/tracking IDs.
- Same literal may populate both only if explicitly used as both roles.
- Do not invent IDs.

## Linking

- `linked`: exact buyer order ID exists for this event, or explicit exact order-to-tracking relation exists.
- `unresolved`: buyer-side event/informational tracking item exists but no exact purchase link is available, or only tracking ID is available.
- `not_applicable`: merchant_outbound or non_purchase.

## H4 benchmark discipline

1. Fix and verify MailLens before H4 selection.
2. Freeze this policy and the runtime prompt before H4 selection/body inspection.
3. Select 100 fresh purchase-category emails content-blind, one message per thread, excluding REAL120 + H1 + H2 + H3 IDs/threads.
4. Freeze H4 selection SHA before body fetch.
5. Create H4 gold/review adjudication before running either local AI or Luna.
6. Freeze local and Luna predictions using the exact same MailLens semantic text, runtime prompt, allowed schema and case order.
7. Do not inspect/tune on one model's H4 failures before the other model prediction artifact is frozen.
8. Only after both predictions are frozen may the deterministic scorer reveal comparative exact/field accuracy.
9. H4 becomes spent immediately after model outputs are inspected.
10. Production OFF; O3 untouched.
