# TechnicalEvidence v1.4 — broad development remeasurement

**Date:** 2026-08-23  
**Mode:** development/regression measurement, shadow only  
**Production writes:** 0  
**AI calls:** 0

## Scope

Remeasure the same ten already-inspected real Gmail commerce families used by the v1.2 broad development measurement after adding:

1. PDF invoice TechnicalEvidence using the existing deterministic PDF text/parser stack;
2. authenticated DPD lifecycle + parcel semantic evidence;
3. authenticated FOXPOST lifecycle + dual carrier-identifier semantic evidence.

This is NOT a fresh blind holdout and is not an accuracy/generalization claim. No raw Gmail ids, order ids, tracking ids, invoice ids, subjects, bodies, customer names or addresses are stored here.

## Same 10-family development set

| Metric | v1.1 | v1.2 | v1.4 |
|---|---:|---:|---:|
| cases inspected | 10 | 10 | 10 |
| auth/transport evidence | 10/10 | 10/10 | **10/10** |
| commerce-specific TechnicalEvidence | 3/10 | 6/10 | **9/10** |
| explicit event TechnicalEvidence | 2/10 | 3/10 | **6/10** |
| hard identifier TechnicalEvidence | 1/10 | 4/10 | **7/10** |

Platform-only and authentication-only observations are intentionally excluded from `commerce-specific` counts.

## What changed from v1.2

### Merchant invoice + attached PDF
The existing deterministic PDF stack already extracts a text layer and has a strict invoice attachment parser. v1.4 converts verified PDF invoice/order references into separate `source=pdf` TechnicalEvidence with provenance instead of flattening attachment text into the email body.

The adapter fails closed when explicit invoice + order references are missing, when the file is not a PDF, or when a provider-qualified legal-identity guard fails.

**Development effect:** previously unsupported family now yields invoice event + hard invoice identity + hard order identity.

### DPD lifecycle
The DPD adapter requires the authenticated sender namespace and uses the stable parcel number exposed in the notification subject/body across shipped, out-for-delivery and delivered lifecycle messages.

It explicitly refuses to reinterpret the opaque myDPD `code=` access token as the parcel number.

**Development effect:** DPD out-for-delivery now yields namespaced DPD parcel identity + lifecycle event evidence.

### FOXPOST lifecycle
The FOXPOST adapter requires the authenticated FOXPOST sender namespace and accepts only explicit provider-labelled identifiers, including the FOXPOST `CLFOX...` identity and, when present, the separately labelled Packeta identity.

A verified pre-advice family proves that identifier creation can precede physical handoff. Therefore pre-advice yields parcel identity but intentionally does **not** yield a physical shipment event. Warehouse and ready-for-pickup messages can yield lifecycle evidence while preserving the same exact FOXPOST identity.

**Development effect:** the previously unsupported FOXPOST family now yields namespaced hard parcel identity + lifecycle evidence without weakening generic number parsing.

## Per-family state after v1.4

1. WooCommerce order — order identity supported; order event still not inferred merely from reusable order-table DOM.
2. UNAS order — generator/action semantics + order event supported.
3. Shopify order — platform provenance supported, but stronger lifecycle discriminator still required before event/identity authority.
4. GLS pre-advice — semantic parcel identity supported; future/conditional delivery does not become physical shipment.
5. MPL out-for-delivery — official Posta tracking namespace yields hard parcel identity.
6. FOXPOST ready-for-pickup — hard FOXPOST identity, optional Packeta identity, lifecycle evidence supported.
7. DPD out-for-delivery — hard DPD parcel identity + lifecycle evidence supported.
8. Billingo invoice — invoice semantics/provider provenance supported.
9. Számlázz.hu invoice — dedicated `X-Szamlazz-Invoice` gives hard namespaced invoice identity + invoice event.
10. Merchant invoice + PDF — PDF gives hard invoice + order identities + invoice event.

## Development interpretation

On the same ten reviewed families:

- commerce-specific support: **30% -> 60% -> 90%**;
- explicit event support: **20% -> 30% -> 60%**;
- hard identifier support: **10% -> 40% -> 70%**.

These are development coverage percentages, not precision/recall or production accuracy.

The only remaining unsupported commerce-specific family in this ten-case slice is Shopify order lifecycle/identity. We intentionally leave it unsupported rather than granting authority from platform fingerprint alone.

## Additional family discovered during PDF measurement: GLS COD receipt

A separate reviewed GLS parcel-locker COD receipt PDF exposes, in the PDF text layer, an explicitly labelled parcel number, transaction number and amount. A provider-qualified `pdf-payment-evidence-v1` adapter was added that requires:

- GLS sender namespace;
- verified GLS legal identity inside the PDF;
- the known payment-receipt filename family;
- all required explicit receipt fields.

It emits shadow-only payment-completed, GLS parcel identity, GLS COD payment reference, amount and HUF currency evidence. Generic PDF labels such as `REF SZÁM` or `CSOMAGSZÁM` remain invalid outside that verified provider context.

If this additional payment-receipt family is appended to the development slice, the extended coverage becomes:

| Metric | Extended 11-family development slice |
|---|---:|
| commerce-specific TechnicalEvidence | **10/11** |
| explicit event TechnicalEvidence | **7/11** |
| hard identifier TechnicalEvidence | **8/11** |

Again, this is development coverage only.

## Safety conclusions

The gain is achieved without granting new generic authority:

- no generic `code=` / `ref=` / `ids=` number harvesting;
- DPD opaque access token is not tracking identity;
- FOXPOST pre-advice is not physical shipment;
- PDF filename alone is never proof;
- PDF labels require document/provider context;
- Shopify platform fingerprint alone remains insufficient for order lifecycle authority;
- no automatic Purchase/Shipment merge authority is added;
- no runtime/DB wiring is added.

## Next gate

1. inspect multiple independent Shopify commerce templates before defining any Shopify lifecycle discriminator;
2. consider QR/barcode TechnicalEvidence for carrier emails, but only as corroborating or namespaced identity evidence;
3. extend PDF evidence to other independently reviewed invoice/payment provider families;
4. run repository typecheck/tests when CI-capable target is available;
5. freeze a new untouched broad holdout before making any generalization or accuracy claim.
