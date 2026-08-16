# UNAS Protocol — 1.0.0-test.1

Status: `test` / shadow only.

This profile combines official UNAS research with sanitized fingerprints observed in real customer order-confirmation emails.

## Test signal

An `ORDER_CREATED` candidate requires all of the following:

- observed UNAS transport host family matching `s<number>.unas.hu`
- rendered `Megrendelés adatok` structure
- explicit `Azonosító`
- `Szállítási mód` and `Fizetési mód` fields
- explicit order-submission/confirmation wording

The visible merchant From-domain is not used as proof that the platform is UNAS.

## Safety

- test registry only; production registry remains unchanged
- no Purchase/Shipment/Document writes
- no AI
- no personal customer data stored in fixtures
- lookalike transport domains must not match
- status-change/payment/shipment lifecycle rules remain research-only
