# eMAG Hungary merchant research — 1.0.0-research.1

Status: **research**. No executable raw-email parser is enabled in V1.

## Why research-only

The first official-source pass established strong order, AWB, pickup, payment, return, refund, invoice and warranty semantics, but did **not** establish a stable first-party set of customer-email sender addresses plus rendered subject/body templates. V1 therefore does not invent eMAG email subjects or sender regexes.

The catalog records merchant/platform facts that future observed customer emails can be checked against.

## Seller identity matters

eMAG is also a Marketplace. Official customer help distinguishes products sold by eMAG from products sold by Marketplace partners. Returns and withdrawal rights are exercised against the actual seller.

BuyFlow consequence: an order seen on the eMAG platform must preserve seller identity. `eMAG platform` must not automatically mean `seller = eMAG`.

## Order identity and structure

Official Marketplace documentation exposes:
- unique order identifier
- order creation timestamp
- payment method
- delivery method
- carrier and AWB
- order total including VAT
- product name, PNK, quantity and price
- invoice and warranty attachment types

These are useful schema expectations. They are not automatically customer-email fields until observed in an actual rendered email.

## Order states

Marketplace seller-side order states include New, Processing/Folyamatban, delayed, completed/finalized and several cancellation/return families.

Important semantic trap: opening/editing a new Marketplace order can move it to `Folyamatban`, which only means the seller has started preparing it. That is `ORDER_PROCESSING`, not shipment progress.

## AWB generation trap

Marketplace documentation states that generating an AWB can automatically set the seller-side order to a completed/finalized state.

That must **never** be translated directly into BuyFlow `DELIVERED`.

V1 treats AWB generation as at most `SHIPMENT_CREATED` evidence:
- no `shipped_at`
- no `IN_TRANSIT`
- no `DELIVERED`

Physical acceptance/transit should come from direct carrier evidence or another source that explicitly proves physical handoff.

## Multiple parcels / AWBs

One eMAG Marketplace order can be split into multiple parcels and can have separate AWBs for those parcels.

BuyFlow must therefore preserve:

```text
1 Purchase
  -> 0..N Shipments / tracking identities
```

Never choose an arbitrary AWB and collapse the other tracking identities just because the order number is the same.

## easybox

Official eMAG customer documentation says the pickup window starts from the SMS/Viber notification that the parcel can be collected from easybox.

Safe mapping:
- notification that parcel is available in easybox -> `READY_FOR_PICKUP`
- never `DELIVERED`

The customer still needs to collect the parcel.

## Payment

Marketplace docs distinguish online card, COD and other payment methods.

For online card payments, seller documentation says unsuccessful card transactions are not registered as valid orders in the seller account.

Safety:
- a payment failure email/provider event can be `PAYMENT_FAILED` evidence;
- payment failure by itself cannot fabricate a Purchase that has no stable order identity;
- direct payment-provider state remains stronger than merchant/platform wording.

COD is paid on receipt to the courier. Selection of COD is a payment method, not `PAYMENT_SUCCESS`.

## Cancellation

eMAG Marketplace supports customer cancellation/withdrawal. A customer cancellation request and a completed cancellation are not necessarily identical evidence states, and cancellation is separate from refund settlement.

BuyFlow must never infer `REFUNDED` just because an order is canceled.

## Return and refund

Official customer help describes a multi-step return flow:
1. customer submits a return request/form;
2. product is collected/returned;
3. returned product is inspected;
4. after approval, eMAG can issue a voucher or return money according to the chosen method.

Therefore:
- return request -> `RETURN`
- return received/approved -> stronger `RETURN`
- refund initiated/merchant-approved -> `REFUNDED` candidate evidence only
- final financial `REFUNDED` should prefer payment-provider/bank settlement evidence when available

`RETURN` must never silently imply `REFUNDED`.

## Invoice / warranty documents

Customer help says invoices are downloadable from the account/order area and warranty documents can be available separately. Marketplace seller tools also support invoice and warranty attachments.

Consequences:
- document availability is useful evidence for `INVOICE` / warranty document existence;
- it does not prove that an arbitrary email attachment is that document;
- a warranty document existing is not the same as an active warranty/service case;
- BuyFlow's existing PDF/document resolver should remain authoritative for exact document identity.

## Warranty / service

For applicable eMAG-sold products, the customer can start a warranty repair process using the warranty repair form. A courier can collect the faulty product and forward it to service.

This can support a `WARRANTY` lifecycle/event candidate once an actual service request/case is observed and linked to the exact product/Purchase.

## Hard-negative families

Do not treat these as purchase lifecycle merely because eMAG branding is present:
- marketing/newsletters/promotions
- password/account messages
- review/rating requests
- Marketplace seller product activation/inactivation messages
- seller stock/account-health/performance notifications

Seller-side Marketplace operational messages are particularly dangerous as customer-lifecycle training data and should be kept separate.

## Verified sources

Primary eMAG sources used in V1:
- eMAG easybox customer flow
- eMAG customer return/service/refund help
- eMAG withdrawal help
- eMAG Marketplace order processing/status documentation
- eMAG Marketplace online card payment documentation
- eMAG Marketplace COD documentation
- eMAG Marketplace AWB/multiple-parcel documentation
- eMAG Marketplace returned-order documentation
- eMAG Marketplace customer cancellation documentation

## Missing evidence / promotion blockers

Before an executable customer-email profile is added:
1. obtain observed real eMAG HU customer order-confirmation emails or first-party published rendered templates;
2. verify actual customer sender domain/address patterns;
3. collect real order-created, processing, shipment/AWB, easybox/pickup, cancellation, invoice, return, refund and warranty subjects/bodies;
4. separate eMAG-sold vs Marketplace-partner seller identity in those messages;
5. test multi-parcel orders with multiple tracking IDs;
6. ensure AWB/Befejezett never becomes delivered;
7. preserve 0 false Purchase, 0 wrong auto-link and 0 return->refund shortcut on the permanent benchmark.
