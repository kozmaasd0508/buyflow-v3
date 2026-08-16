# Shopify Protocol — 1.0.0-test.1

Status: `test` / shadow only.

The Shopify test profile remains deliberately conservative. The shared `shopifyemail.com` sender infrastructure is useful platform evidence, but observed real promotional traffic confirms that it cannot establish merchant identity or a purchase lifecycle event by itself.

## Current behavior

- shared Shopify sender -> `OTHER`
- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- no order/shipment/payment/refund lifecycle parser yet

Transactional Shopify lifecycle parsing stays blocked until real rendered transactional emails provide stable fingerprints beyond the shared sender channel.
