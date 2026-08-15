# WooCommerce protocol research — 1.0.0-research.1

Status: **research**. This profile is intentionally not registered for production runtime detection.

## Why research-only

WooCommerce core provides built-in transactional email classes and templates, but store owners can edit subjects/headings/additional content, themes can override templates, and extensions/custom code can add or change emails. Therefore a default WooCommerce subject is only evidence. It is never sufficient global proof that an arbitrary email is WooCommerce or that a final lifecycle state is true.

The V1 research profile only models combinations where multiple core-default structural signals agree. Existing BuyFlow classifier/resolution remains authoritative.

## Verified core email families

| WooCommerce core email | Verified trigger/meaning | Default/core fingerprint | BuyFlow V1 treatment |
|---|---|---|---|
| Processing order | Customer email on transitions into Processing; Woo docs define Processing as paid and awaiting fulfillment for normal physical orders | default subject says the order was received; plain template says the order was received and is now being processed; order details contain `Order #...` | `ORDER_PROCESSING`; `DO_NOT_CREATE_PURCHASE`, no shipping/delivery promotion |
| Order on hold | Pending/Failed/Cancelled to On hold; payment confirmation may still be pending | block-email default subject says order is on hold | documented only; not mapped in V1 because BuyFlow has no exact `PAYMENT_PENDING_CONFIRMATION` event and `PAYMENT_ACTION_REQUIRED` would overstate the meaning |
| Failed order | Customer email when order is marked Failed | default subject says the order was unsuccessful; heading says the same | `PAYMENT_FAILED`; lifecycle only |
| Cancelled order | Customer email when Processing/On hold changes to Cancelled | default subject contains exact order number and cancellation | `CANCELLED`; lifecycle only |
| Completed order | Customer email when order reaches Completed; Woo describes this as fulfilled/complete and usually shipped | current improved subject can say the order is on its way; legacy subject says order is complete | **not mapped** in V1: Completed is not recipient delivery and may not prove physical shipment for virtual/downloadable commerce |
| Refunded order | Separate full and partial refund notifications | subjects distinguish full vs partial refund and include order number | `REFUNDED` candidate evidence but always `DO_NOT_MARK_REFUNDED` until stronger payment-provider/bank evidence corroborates settlement |
| Order details / historical Customer Invoice class | Manual email from order admin; can contain payment link when payment is needed | subject contains order number; unpaid body contains explicit retry/make-payment link text | `PAYMENT_ACTION_REQUIRED` only when payment copy is explicit; never `INVOICE` merely because the historical PHP class is called `Customer_Invoice` |
| Fulfillment created | Merchant creates fulfillment and marks it fulfilled; draft fulfillment does not notify | subject identifies fulfilled item(s) and order; heading says item(s) are on the way | `SHIPPED` merchant evidence; never `DELIVERED` |
| Fulfillment updated | Merchant updates fulfilled fulfillment; draft changes do not notify | fulfillment update email can describe changed shipment/tracking details | documented, not mapped in V1 until update semantics are split safely |
| Fulfillment deleted | Merchant cancels/removes an already fulfilled fulfillment | separate fulfillment-deleted email | documented, not mapped to order `CANCELLED` because shipment fulfillment cancellation is not order cancellation |

## Order/body structure

WooCommerce core order-detail emails render an order summary and order number, followed by item rows and totals. The current template exposes product, quantity and price columns, then order item totals. These are useful structural fingerprints, but themes/plugins may override them.

Useful verified identity shape:
- `Order #<order number>` or legacy `[Order #<order number>]`
- order number is a Woo order number, which plugins may customize; BuyFlow must not assume numeric-only globally

V1 identifier patterns require a digit-bearing value and never accept an arbitrary word after `order` as an ID.

## Fulfillment/tracking structure

Current WooCommerce fulfillment email details can expose:
- `Tracking Number`
- `Shipment Provider`
- `Tracking URL`
- `Order #...`
- fulfillment item summary

A fulfilled fulfillment can therefore supply merchant-side tracking evidence. Direct carrier evidence still has higher authority for physical logistics state.

## Payment semantics

Core order states matter:
- Pending payment: order received, unpaid
- On hold: awaiting payment confirmation / delayed or offline confirmation
- Processing: payment received, awaiting fulfillment for normal physical goods
- Failed: payment failed/declined or timed out/abandoned depending on gateway flow

The manual Order details email can include a checkout payment URL and explicit payment/retry language. V1 only emits `PAYMENT_ACTION_REQUIRED` when that payment copy is present; the same subject on an already-paid order is not enough.

## Refund safety

WooCommerce distinguishes full and partial refund emails. However, WooCommerce documentation warns that a manually handled refund/status can exist without proof that funds were actually returned to the customer. Therefore merchant Woo refund evidence is retained but cannot finalize BuyFlow `REFUNDED` state by itself.

## Completed-order safety

WooCommerce `Completed` means the order is fulfilled/complete and usually indicates shipment. Current email improvements may even use an “on its way” style subject. BuyFlow must still not interpret this as `DELIVERED`. V1 also avoids setting `SHIPPED` from Completed alone because physical shipment is not guaranteed for every Woo order; the newer fulfillment-created evidence is more specific.

## Hard negatives / non-purchase-lifecycle Woo emails

Core WooCommerce also sends or supports emails such as:
- customer note
- reset password
- new account

Extensions can add many more notifications. These must not become purchase lifecycle events merely because they share store branding or mention an order.

## Positive fixtures in V1

Research tests cover:
1. processing order
2. payment failed
3. cancelled order
4. unpaid order-details/payment request
5. full refund evidence
6. partial refund evidence
7. fulfillment-created/shipped evidence with tracking

## Hard-negative / conservative fixtures in V1

Tests require:
- paid Order details email is not `INVOICE` or payment action required
- Completed email is not `DELIVERED` or `SHIPPED` in V1
- account-created email ignored
- customer-note email ignored
- reset-password email ignored
- default-looking processing subject without verified body structure ignored

## Primary sources

- WooCommerce Email Settings: https://woocommerce.com/document/configuring-woocommerce-settings/emails/
- WooCommerce Order Statuses: https://woocommerce.com/document/managing-orders/order-statuses/
- WooCommerce Order Fulfillment: https://woocommerce.com/document/order-fulfillment/
- Processing email class: https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-processing-order.html
- Processing plain template: https://woocommerce.github.io/code-reference/files/woocommerce-templates-emails-plain-customer-processing-order.html
- Failed customer email class: https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-failed-order.html
- Cancelled customer email class: https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-cancelled-order.html
- Completed customer email class: https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-completed-order.html
- Refunded customer email class: https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-refunded-order.html
- Order details / historical invoice class: https://woocommerce.github.io/code-reference/files/woocommerce-includes-emails-class-wc-email-customer-invoice.html
- Order details payment template: https://woocommerce.github.io/code-reference/files/woocommerce-templates-emails-plain-customer-invoice.html
- Order detail table template: https://woocommerce.github.io/code-reference/files/woocommerce-templates-emails-email-order-details.html
- Fulfillment-created source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/emails/class-wc-email-customer-fulfillment-created.php
- Fulfillment details source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/templates/emails/plain/email-fulfillment-details.php

## Promotion blockers

Do not promote this profile to `test`/`production` yet. Before promotion:
1. verify current localized/Hungarian core translations from an authoritative source or observed real emails;
2. add more positive variants for legacy vs email-improvements/block-editor templates;
3. determine a robust Woo platform fingerprint that does not rely on a customizable subject alone;
4. test the profile against the permanent 100-email corpus and existing real BuyFlow merchant fixtures;
5. ensure no false Purchase creation, wrong link, delivered promotion or refund finalization;
6. decide how to represent On hold/payment-pending without forcing it into `PAYMENT_ACTION_REQUIRED`.
