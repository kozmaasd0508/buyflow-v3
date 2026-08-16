# eMAG Hungary merchant shadow profile — 1.0.0-test.1

Status: `test` / shadow only.

## Scope

This first eMAG profile intentionally implements **no positive purchase lifecycle event**. Targeted Gmail research did not find a sufficiently strong direct authenticated eMAG order-confirmation, shipment, delivery, cancellation, return or settled-refund recipient email in the connected mailbox.

V1 instead captures a high-value abandoned-cart hard negative.

## Observed abandoned-cart structure

A real recipient email used:

- sender `no-reply-t@emag.hu`
- authenticated `emag.hu` DKIM
- SPF pass from `cto.emag.hu`
- DMARC pass for `emag.hu`
- subject containing `miért érdemes befejezned a rendelésed`
- body explicitly stating `a rendelést nem véglegesítetted`
- body explicitly stating that adding products to the cart does not reserve them
- concrete product, quantity and price information
- generic information about cancellation, Instant Money Back, returns and Fast Refund

The last two bullets make this an especially dangerous false-positive candidate: a naive recognizer could create a purchase or mark a refund merely because the email contains realistic commerce data and refund vocabulary.

## Mapping

### Abandoned cart

`OTHER`

Prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`
- `DO_NOT_MARK_REFUNDED`

## Current eMAG status research

Official eMAG Marketplace documentation currently distinguishes seller-side states including `Új`, `Folyamatban`, `Késett`, `Befejezett`, buyer/seller/automatic cancellation and `Visszajött`. It also exposes separate shipping status, AWB and payment status fields.

These semantics are useful for understanding the platform but are **not recipient-email templates**. They must not become email regex rules until a direct authenticated customer email is observed.

Official return/refund guidance also separates:

1. return request / withdrawal,
2. carrier collection or customer return,
3. item receipt and inspection,
4. approval / invoice cancellation,
5. actual refund or voucher credit.

Therefore `visszaküldés`, `visszatérítés` or refund-policy text alone is never enough for `RETURN` or `REFUNDED`.

## Hard negatives

V1 regression coverage includes:

- abandoned cart with real-looking product/price data
- abandoned cart containing refund and return vocabulary
- eMAG marketing about Saturday/easybox delivery
- promotional cashback wording
- subject-only abandoned-cart message
- lookalike DKIM
- invented order-confirmation/shipped/delivered/refunded samples: deliberately unsupported until observed

## Authority rules

- direct authenticated carrier evidence outranks eMAG merchant wording for logistics
- direct authenticated payment-provider evidence outranks eMAG merchant wording for payment
- eMAG seller-platform status names do not imply that the same wording appears in customer email
- marketing and cart-recovery emails never create purchases

## Production

The production registry remains empty. This profile is available only through the shadow/test registry.
