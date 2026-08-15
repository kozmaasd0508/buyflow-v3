# Shopify protocol research — 1.0.0-research.1

Status: **research**. This profile is not registered for production lifecycle extraction.

## Research strategy

Shopify differs from a self-hosted engine such as WooCommerce. Shopify documents a rich set of customer notification **events** and Liquid variables, but merchants can edit both the email subject and HTML body. A Shopify store can also send from its authenticated merchant domain. If authentication is missing or rewriting is required, Shopify can use a `store+<unique id>@shopifyemail.com` style sender (and in some DMARC situations `no-reply@shopifyemail.com`).

Therefore V1 separates two facts:

1. `shopifyemail.com` is strong **shared platform-channel evidence**, not merchant identity.
2. Shopify notification event semantics can be documented safely before we have stable rendered-email fingerprints for each notification.

The executable V1 profile consequently emits only `OTHER` for the shared Shopify sender channel and carries `DO_NOT_CREATE_PURCHASE` + `DO_NOT_AUTO_LINK`. Lifecycle extraction remains disabled until source-backed rendered patterns or observed real emails exist.

## Verified notification/event semantics

| Shopify notification | BuyFlow research mapping | Safety interpretation |
|---|---|---|
| Order confirmation | `ORDER_CREATED` candidate | Shopify says it is sent when the customer places an order. Auto Purchase still needs stable order + merchant identity. |
| Shipping confirmation | `SHIPMENT_CREATED` | Sent when the order is fulfilled. Fulfillment does not prove carrier physical acceptance, so no `shipped_at`, `IN_TRANSIT`, or `DELIVERED`. |
| Shipping update | `OTHER` in V1 | Tracking data changed; this does not necessarily prove physical progress. |
| Out for delivery | `OUT_FOR_DELIVERY` | Shopify says this is triggered by a corresponding tracking event from carrier/fulfillment app. Never delivered. |
| Delivered | `DELIVERED` candidate | Also based on carrier/fulfillment-app tracking event. Direct carrier evidence remains higher authority. |
| Order canceled | `CANCELLED` | Cancellation and refund are separate facts. A cancellation workflow can optionally refund, so never infer refund from cancellation alone. |
| Order refund | `REFUNDED` candidate with `DO_NOT_MARK_REFUNDED` | Merchant/platform refund evidence; final settlement should prefer payment-provider evidence. |
| Pending payment success | `PAYMENT_SUCCESS` | Shopify documents a customer email after pending payment succeeds. Direct provider state still outranks it. |
| Pending payment error | `PAYMENT_FAILED` | Shopify documents failed processing plus a Pay now retry link. |
| Ready for pickup | `READY_FOR_PICKUP` | Sent when staff marks an in-store pickup order ready. Explicitly not customer receipt. |
| Picked up by customer | `OTHER` in V1 | Shopify can send a pickup confirmation after staff marks it picked up. BuyFlow currently has no canonical `PICKED_UP`; do not silently alias to delivered. |
| Return request confirmation | `RETURN` | Confirms a request, not approval, physical return, or refund. |
| Return request approved | `RETURN` | Approval can include label/instructions and exchange balance payment action; not a settled refund. |
| Return created | `RETURN` | Return workflow; exchange variants can contain an outstanding balance / Pay now action. |
| Local delivery confirmation | `DELIVERED` candidate | Separate from carrier tracking; sent when merchant marks local-delivery order delivered. Lower authority than direct carrier delivery evidence. |
| Order edited | `OTHER` in V1 | An edit can create money owed or a refund requirement, but the edit itself is neither settled payment nor refund. |

## Identifiers / data model

Shopify notification templates use Liquid and expose order properties. Official variable documentation confirms:
- `name` / `order_name` — typically `#` plus the order number
- `order_number` — store-unique order number without the `#` and without owner-added prefix/suffix
- `confirmation_number` — random alphanumeric identifier that may be customer-facing but is **not guaranteed unique**
- `id` — system-wide internal order ID

This creates an important BuyFlow rule: do not treat `confirmation_number` as a globally unique Purchase identity. Prefer a stable explicit order name/number combined with merchant identity, and preserve the raw identifier form observed in the email.

V1 intentionally adds no raw order-ID regex because Shopify rendered templates are customizable and localization changes visible labels.

## Sender identity

Official Shopify email configuration documentation confirms that automatic order notifications use the store's configured Sender email. Depending on authentication, a message can be rewritten to `store+<id>@shopifyemail.com`, display via `shopifyemail.com`, or use the merchant's authenticated custom domain.

Consequences:
- `shopifyemail.com` can establish **Shopify protocol evidence**.
- it cannot establish which merchant owns the order by itself;
- multiple Shopify shops must never collapse into one merchant merely because they share `shopifyemail.com`;
- a merchant-domain sender does not rule Shopify in or out without another fingerprint.

## Template customization

Shopify allows merchants to edit the Email subject and Email body (HTML) of individual notification templates, and to revert to default. Templates can also vary by language. Therefore notification names such as `Order confirmation` or `Ready for pickup` are admin/event names, **not assumed raw email subject strings** in this library.

This is why V1 does not create speculative subject regexes such as `Your order is confirmed`.

## Fulfillment safety

Shopify's own notification documentation distinguishes:
- fulfill order → Shipping confirmation
- tracking event reports out-for-delivery → Out for delivery
- tracking event reports delivered → Delivered

This maps cleanly to BuyFlow's evidence precedence:

```text
Shopify fulfillment confirmation
  → SHIPMENT_CREATED merchant/platform evidence

direct carrier physical acceptance / transit
  → stronger logistics evidence

Shopify relayed out-for-delivery/delivered tracking event
  → useful lifecycle evidence

direct carrier out-for-delivery/delivered
  → still higher authority
```

Local delivery is separate: it doesn't use the normal carrier tracking notifications; Shopify sends local delivery confirmation when staff marks it delivered.

## Pickup safety

For in-store pickup, Shopify has separate stages:
- mark ready → Ready for pickup notification
- customer collects → mark picked up → optional Picked up by customer confirmation

`READY_FOR_PICKUP` therefore must never be interpreted as delivery. The terminal `Picked up` state remains an explicit taxonomy question in BuyFlow instead of being silently collapsed into `DELIVERED` in this research version.

## Payment safety

Shopify documents pending-payment success and error notifications for additional providers. On failure the email can include a Pay now retry link. Shopify also distinguishes authorized transactions from captured transactions in current notification templates.

Rules:
- authorization != captured payment;
- pending payment success can support `PAYMENT_SUCCESS`;
- pending payment error supports `PAYMENT_FAILED`, with retry/action metadata if extracted;
- direct provider state remains stronger than Shopify's merchant/platform notification.

## Refund / cancellation / edit safety

Cancellation can optionally include a refund, but these are distinct facts. `Order canceled` is therefore only `CANCELLED` evidence.

`Order refund` is refund evidence, but BuyFlow keeps `DO_NOT_MARK_REFUNDED` until payment-provider or equally strong settlement evidence confirms actual funds movement.

`Order edited` is not mapped to payment/refund. An edit can increase or decrease the amount owed, and follow-up payment/refund actions are separate.

## Returns / exchanges

Shopify supports return request confirmation, approval and decline notifications. Current exchange-aware templates can also include:
- items to return
- items the customer will receive
- return labels/tracking
- financial summary
- outstanding exchange balance and Pay now action

Therefore a return email can carry both `RETURN` and payment-action evidence, but it must not be converted directly into `REFUNDED`.

## Hard negatives / adjacent noise

The Shopify ecosystem can also send customer-account, authentication, marketing, abandoned checkout/POS and other notifications. Shared Shopify delivery infrastructure or branding alone is insufficient for a purchase lifecycle event.

Foundation rule: `shopifyemail.com` by itself → protocol `OTHER`, never Purchase, never auto-link.

## Primary sources

- Shopify customer notifications: https://help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications
- Notification template customization: https://help.shopify.com/en/manual/fulfillment/setup/notifications/customizing-notification-template
- Notification variables: https://help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables
- Sender email setup/rewrites: https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-your-email
- Pending payments: https://help.shopify.com/en/manual/fulfillment/managing-orders/payments/pending-payments
- Pickup in store: https://help.shopify.com/en/manual/fulfillment/setup/delivery-methods/pickup-in-store
- Local delivery fulfillment: https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/local-delivery-fulfillment
- Self-serve returns: https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/self-serve-returns/setup
- Exchange notification updates: https://help.shopify.com/en/manual/fulfillment/setup/notifications/exchange-notifications
- Shopify Tax notification template update index: https://help.shopify.com/en/manual/taxes/shopify-tax/notifications

## Promotion blockers

Before enabling lifecycle extraction from raw Shopify mail:
1. collect observed real rendered emails or first-party published rendered template text for each target notification;
2. cover multiple languages and customized subject variants without turning them into global keywords;
3. resolve merchant identity safely when sender is shared `shopifyemail.com` (for example independently verified shop/domain/order-status URL evidence);
4. decide canonical handling for `Picked up by customer`;
5. add Order edited semantics without confusing edit with refund/payment;
6. test against the permanent 100-email corpus and real hard negatives;
7. require 0 false Purchase, 0 wrong auto-link, 0 ready-for-pickup→delivered, 0 refund finalization from merchant evidence alone.
