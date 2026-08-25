# TechnicalEvidence v1.1 — broad development measurement

**Date:** 2026-08-23  
**Mode:** development/regression measurement, shadow only  
**Production writes:** 0  
**AI calls:** 0

## Purpose

Test whether the strong 6-case GymBeam / Express One development result generalizes to different webshop engines, carriers and invoice providers.

This set contains ten already-inspected real Gmail commerce messages. It is NOT a fresh blind holdout and MUST NOT be used as an accuracy claim. No raw Gmail ids, order ids, tracking ids, invoice ids, subjects, bodies, addresses or customer data are stored here.

## Families in the 10-case expansion

### Webshop engines
1. WooCommerce order confirmation
2. UNAS order confirmation
3. Shopify order confirmation

### Carriers
4. GLS parcel/pre-advice
5. MPL out-for-delivery
6. FOXPOST ready-for-pickup
7. DPD out-for-delivery

### Invoice/document providers
8. Billingo invoice notification
9. Számlázz.hu invoice notification
10. merchant invoice email with attached PDF

## Current v1.1 result

| Metric | Result |
|---|---:|
| cases inspected | 10 |
| auth/transport evidence present | **10/10** |
| commerce-specific TechnicalEvidence currently recognized | **3/10** |
| explicit event TechnicalEvidence | **2/10** |
| hard identifier TechnicalEvidence | **1/10** |

`platform` and generic authentication/transport raw signals are deliberately NOT counted as commerce-specific event/field evidence.

## Cases currently supported by v1.1

### UNAS order confirmation
The HTML title itself contains order-confirmation semantics, so the existing HTML-title extractor yields `order_created`. The `X-Mailer` also identifies the UNAS generator, but generator identity alone is not counted as commerce event evidence.

### GLS parcel/pre-advice
A direct GLS URL contains a semantic `parcelNumber=...` query parameter. v1 URL evidence yields exact tracking identity, and v1.1 can independently observe the English `Parcel number` label. The email wording is conditional/future pre-advice, so v1.1 correctly does NOT promote it to a physical shipped/delivered event.

### Billingo invoice notification
The HTML title contains invoice semantics, so the existing title evidence yields `invoice_or_receipt`. Authenticated Billingo transport also provides provenance, but no hard invoice identifier is currently extracted from the machine layer in this sample.

## Important unsupported-but-machine-readable cases

### WooCommerce
The real message contains stable WooCommerce DOM/class semantics including `woocommerce-Price-amount`, `woocommerce-Price-currencySymbol` and `shipped_via`, plus an English order table structure. Current v1 recognizes only `platform=WooCommerce`; it does not yet convert the combined commerce DOM structure into order event/field evidence.

### Shopify
The real message carries stable Shopify transport/template fingerprints: authenticated mailer host, Shopify Message-ID / Feedback-ID and notification DOM classes such as `order-list__product-image`. Current collector does not yet promote these authenticated platform/template signals into a platform/order semantic observation.

### MPL
The tracking URL is structurally strong but uses the provider-specific query alias `ids` on the official Posta tracking path. Accepting generic `ids` globally would be unsafe. A host/path-qualified URL semantic registry is needed.

### FOXPOST
The message contains two carrier identifiers and a QR code, but the tracking target is wrapped by a mail redirect and the identifiers are labelled in provider-specific Hungarian structure. Current v1.1 intentionally does not guess through the redirect or treat arbitrary numeric/text labels as hard tracking identity.

### DPD
The real out-for-delivery message has a stable provider template and a parcel number, but the visible tracking link contains an opaque access `code` that is NOT the parcel number. Current v1.1 correctly refuses to treat generic `code` as tracking identity. A carrier-template semantic adapter is needed rather than weakening URL rules.

### Számlázz.hu
The raw message has a dedicated machine header `X-Szamlazz-Invoice: <invoice>`. Current generic header-name vocabulary does not recognize the provider-prefixed semantic field, so this excellent hard invoice evidence is currently missed.

### Merchant invoice + PDF
The email attachment itself is the strongest machine-readable source. The PDF text layer contains invoice/order linkage and financial/document fields, but PDF is not yet part of TechnicalEvidence v1.1.

## Interpretation

The six-case v1.1 improvement was real but narrow. The broader set proves a more important architectural point:

> Useful stable machine evidence is common, but it is NOT represented by one universal English-email grammar.

Across real systems the stable layer appears as:

- semantic English duplicate text;
- provider/template event headers;
- platform DOM/classes;
- authenticated transport/provider fingerprints;
- host/path-qualified URL parameters;
- provider-specific machine headers;
- PDF document fields;
- QR/barcode payloads.

Therefore the correct architecture is still multi-layer TechnicalEvidence, but with small auditable **platform/provider/carrier semantic adapters**, not one global regex vocabulary and not per-merchant patches.

## Safest v1.2 targets derived from this measurement

1. **Platform semantic evidence**
   - WooCommerce commerce DOM combinations;
   - UNAS generator/action fingerprint;
   - Shopify authenticated transport/template fingerprint + notification DOM.

2. **Host/path-qualified URL semantics**
   - official MPL/Posta tracking path + `ids`;
   - never accept generic `ids`, `code` or `ref` globally.

3. **Provider semantic header aliases**
   - dedicated invoice headers such as provider-prefixed invoice fields where header meaning is explicit.

4. **Carrier template semantics**
   - DPD/FOXPOST families only through exact authenticated provider namespace + explicit template structure/labels;
   - no unsafe generic number harvesting.

5. **PDF TechnicalEvidence**
   - build on the existing PDF text extraction stack;
   - invoice/order/tracking/payment fields must preserve document-level provenance.

6. **QR/barcode** only after PDF and only as corroborating/typed evidence unless payload semantics are independently proven.

After v1.2, rerun this same 10-case development set. Only then freeze a new untouched broad set for a blind generalization gate.
