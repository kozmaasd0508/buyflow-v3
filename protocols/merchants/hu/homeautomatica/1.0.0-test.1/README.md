# Home Automatica Kft — Shoprenter shadow profile

Status: `test` / shadow only

Protocol id: `merchant.hu.homeautomatica`

Version: `1.0.0-test.1`

## Why this merchant matters

A real Home Automatica customer journey exposed a particularly useful Shoprenter lifecycle:

1. order confirmation
2. failed card payment
3. successful card retry
4. merchant status `Jóváírás`
5. merchant status `FoxPost szállításra előkészítve`
6. merchant status `Elküldve`
7. direct FOXPOST pre-advice / warehouse / pickup-ready evidence in the same journey

All fixtures in code are sanitized. No real customer name, address, phone number, order id, transaction id or parcel id is stored.

## Verified infrastructure

Observed messages used:

- merchant visible sender: `info@homeautomatica.hu`
- merchant domain: `homeautomatica.hu`
- Shoprenter DKIM: `mail6.smtp.shoprenter.hu`
- Shoprenter return-path domain: `mail6.smtp.shoprenter.hu`

This is the same Shoprenter infrastructure family independently observed for another merchant, strengthening the distinction between stable platform infrastructure and merchant-configured visible lifecycle wording.

## Enabled shadow mappings

### ORDER_CREATED

Requires merchant identity, verified Shoprenter infrastructure, the rendered order-confirmation structure and explicit order identity.

### PAYMENT_FAILED

Requires the dedicated failed-card-payment subject, explicit failed-payment copy, transaction reference and a non-success response code.

Because the observed merchant order id was only three digits, the lifecycle evidence carries `DO_NOT_AUTO_LINK`.

### PAYMENT_SUCCESS

Requires the dedicated success subject, explicit `sikeresen befizette` copy, response code `00` and `Tranzakció elfogadva`.

The later merchant status `Jóváírás` is therefore proven to be a payment-side merchant label in this journey, not a refund signal.

### SHIPMENT_CREATED

`FoxPost szállításra előkészítve` maps only to `SHIPMENT_CREATED`.

This is unusually strong evidence because a direct FOXPOST `Előértesítés` followed immediately in the observed journey and explicitly stated that the parcel number had been created but the parcel had **not yet been handed to FOXPOST**.

Therefore the profile preserves:

- `DO_NOT_SET_SHIPPED_AT`
- `DO_NOT_MARK_IN_TRANSIT`
- `DO_NOT_MARK_DELIVERED`

### OTHER safety statuses

`Jóváírás` and `Elküldve` status-only messages are retained only as `OTHER` merchant evidence.

- `Jóváírás` alone must never become `REFUNDED`.
- `Elküldve` alone must never become physical `SHIPPED`, `IN_TRANSIT` or `DELIVERED`.
- direct carrier evidence remains the stronger logistics authority.

## Main research conclusion

Two independent Shoprenter merchants now show the same mail infrastructure while using different merchant lifecycle labels. This supports the architecture decision to generalize **platform identity** carefully, but keep **status semantics merchant-specific** until repeatedly verified.

## Production blockers

Before any production promotion:

- collect more Home Automatica orders to confirm the same status meanings repeat
- verify whether three-digit order ids are unique enough over the resolver time window
- require strong existing Purchase identity before lifecycle auto-linking
- preserve direct carrier authority over merchant logistics wording
- keep `Jóváírás` explicitly blocked from refund semantics

No production registry entry is added by this profile.
