# Shoprenter Protocol — 1.0.0-test.1

Status: `test` / shadow only.

This profile combines official Shoprenter research with sanitized fingerprints observed in real customer order-confirmation emails.

## Test signal

An `ORDER_CREATED` candidate requires all of the following:

- Shoprenter DKIM domain under `smtp.shoprenter.hu`
- Shoprenter return-path domain under `smtp.shoprenter.hu`
- explicit wording that the order arrived and processing started
- rendered `Rendelés részletei` block
- explicit `Rendelésszám`

Merchant-visible From-domain or subject alone is never enough.

## Safety

- test registry only; production registry remains unchanged
- no Purchase/Shipment/Document writes
- no AI
- no personal customer data stored in fixtures
- lookalike DKIM/return-path domains must not match
- status changes, tracking links and payment descriptions remain research-only
