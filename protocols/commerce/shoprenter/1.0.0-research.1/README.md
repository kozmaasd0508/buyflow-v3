# Shoprenter protocol research — 1.0.0-research.1

Status: **research**. The executable part only recognizes Shoprenter's documented shared fallback sender as platform evidence; it does not classify lifecycle events.

## Email customization

Shoprenter automatic emails are tied to system events, but merchants can edit:
- sender address
- sender name
- subject
- text body
- HTML body
- attachments for order confirmation/status emails

Subjects may use event-specific tags. Because the visible content is configurable, a Shoprenter admin event name must not be assumed to be the raw customer email subject.

## Shared sender evidence

Shoprenter officially documents that when a Gmail address is configured as sender, the actual sender becomes:

`order@myshoprenter.hu`

This is useful platform evidence but it is shared infrastructure, not merchant identity.

V1 therefore emits only:
- protocol: `commerce.shoprenter`
- event: `OTHER`
- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`

when that exact sender is observed.

Stores are encouraged to use their own domain sender, so the absence of `myshoprenter.hu` does not rule out Shoprenter.

## Order confirmation

Shoprenter has a dedicated automatic `Rendelés visszaigazolás` event/email. This can support an `ORDER_CREATED` candidate, but only when the rendered email also yields:
- verified merchant identity
- stable order identity
- sufficient order-creation evidence

No global subject regex is enabled in V1 because the subject/body are editable.

## Order status change

Shoprenter has a `Rendelés állapot váltás` automatic email. Individual order states and status-change email content can be customized, and order comments can be added with `[ORDER_COMMENT]` when configured.

Safety:
- status-change mail is lifecycle evidence;
- its exact meaning is merchant-specific;
- do not map arbitrary configured state names globally to processing/shipped/delivered/cancelled;
- merchant-specific verified state profiles may later map those values.

## Tracking / Shoprenter Go

Shoprenter Go can insert `[SHOPRENTER_GO_TRACKING_LINK]` into a status-change email after the shipping label has been generated.

This proves that tracking/link data can exist in a Shoprenter email, but label generation is not physical carrier acceptance.

Consequences:
- useful for shipment identity/link extraction;
- `DO_NOT_SET_SHIPPED_AT` from this signal alone;
- `DO_NOT_MARK_IN_TRANSIT`;
- `DO_NOT_MARK_DELIVERED`;
- direct carrier lifecycle evidence remains stronger.

## Payment

Shoprenter payment-method configuration can inject `[PAYMENT_DESCRIPTION]` into the order confirmation.

This can describe the selected payment method/instructions, but method text does not prove a payment state. Never convert payment description alone into `PAYMENT_SUCCESS` or `PAYMENT_FAILED`.

Payment-provider evidence should remain authoritative for final financial state.

## Attachments

Official Shoprenter docs allow configured attachments on:
- order confirmation emails
- order status-change emails

These can be relevant documents, but attachment presence/name alone is not invoice identity. BuyFlow's existing PDF/document pipeline should inspect and resolve documents separately.

## Hard-negative families

The Shoprenter ecosystem can send emails unrelated to a purchase lifecycle, including:
- wishlist-sharing email
- stock-availability notification
- marketing/automation emails
- subscription renewal reminder
- subscription modification notice
- subscription setup/payment error
- subscription welcome email

These are especially important because they may use the same merchant sender and branding.

## Primary sources

- Automatikus emailek: https://support.shoprenter.hu/hc/hu/articles/215106278-Automatikus-emailek
- Rendelések: https://support.shoprenter.hu/hc/hu/articles/215106568-Rendel%C3%A9sek
- Shoprenter Go: https://support.shoprenter.hu/hc/hu/articles/6636165262877-Shoprenter-Go
- Fizetési módok: https://support.shoprenter.hu/hc/hu/articles/360010170777-Fizet%C3%A9si-m%C3%B3dok
- Tartalom menü: https://support.shoprenter.hu/hc/hu/articles/215106238-Tartalom-men%C3%BC
- Termék előfizetés: https://support.shoprenter.hu/hc/hu/articles/16931694947741-Term%C3%A9k-el%C5%91fizet%C3%A9s

## Promotion blockers

Before event-level raw-email activation:
1. collect observed real rendered order confirmation/status emails;
2. recover stable order-number fingerprints from rendered messages;
3. verify merchant-specific status semantics;
4. test tracking-link extraction without physical-progress promotion;
5. collect hard negatives from the same merchant/system;
6. preserve the existing 100-email benchmark safety baseline.
