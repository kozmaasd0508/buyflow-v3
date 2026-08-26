# TechnicalEvidence QR preflight — 2026-08-23

**Mode:** development observation only  
**Production writes:** 0  
**AI calls:** 0

## Reviewed case

A real reviewed FOXPOST ready-for-pickup email contains an inline QR image plus a separately visible pickup/opening code and hard carrier identifiers.

The QR payload was decoded locally from the attachment image for this development check. No raw QR payload, tracking number, Gmail id, customer data or address is stored in this report.

## Result

The QR payload matches the visible pickup/opening code. It does **not** match the FOXPOST parcel identifier or the Packeta parcel identifier.

Therefore:

- QR payload must **not** be promoted to Shipment identity evidence;
- QR payload must **not** be interpreted as tracking number merely because it is numeric;
- QR may be useful later as a separate `pickup_code` / access-action corroboration field;
- the hard shipment identity must continue to come from explicit provider-labelled FOXPOST/Packeta identifiers and other namespaced carrier evidence.

## Architecture implication

Do not add a generic QR-to-tracking extractor.

If a QR layer is implemented later, it should have a separate semantic contract such as:

```text
qr payload
+ authenticated carrier namespace
+ visible labelled pickup/opening code
+ exact payload/code agreement
→ pickup_code corroboration

NOT
→ tracking_number
```

## Coverage impact

This QR observation does not increase the v1.4 hard-identifier coverage metric. That is intentional: the QR adds action corroboration, not identity.
