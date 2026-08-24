# TechnicalEvidence v1.2 — broad development remeasurement

**Date:** 2026-08-23  
**Mode:** development/regression measurement, shadow only  
**Production writes:** 0  
**AI calls:** 0

## Scope

Remeasure the same ten already-inspected real Gmail commerce families used by the v1.1 broad development measurement. This is NOT a fresh blind holdout and is not an accuracy claim.

No raw Gmail ids, order ids, tracking ids, invoice ids, subjects, bodies, addresses or customer data are stored in this document.

## v1.1 -> v1.2

| Metric | v1.1 | v1.2 |
|---|---:|---:|
| cases inspected | 10 | 10 |
| auth/transport evidence | 10/10 | 10/10 |
| commerce-specific TechnicalEvidence | 3/10 | **6/10** |
| explicit event TechnicalEvidence | 2/10 | **3/10** |
| hard identifier TechnicalEvidence | 1/10 | **4/10** |

Platform-only and authentication-only observations are intentionally excluded from `commerce-specific` counts.

## Per-family result

### WooCommerce order
**v1.1:** platform fingerprint only.  
**v1.2:** multi-primitive WooCommerce DOM context plus stable `Order #...` template label yields exact order identity. It does NOT grant ORDER_CREATED event authority because the same order table can appear in later lifecycle mail.

### UNAS order
Already recognized by HTML title in v1.1. v1.2 additionally understands exact `X-Mailer: Unas MAIL /shop_order_send.php ...` as an order-confirmation generator action. A separate real UNAS status message uses `/admin_order_det.php`, proving that generator action can distinguish the two families. The trailing numeric generator value is explicitly NOT treated as an order id.

### Shopify order
v1.2 now recognizes Shopify platform provenance only when at least two independent transport/template signals agree (for example authenticated mailer host / Shopify Message-ID / Feedback-ID / notification DOM). Platform provenance alone still grants no order event or hard order id, so this case is not counted as commerce-specific TechnicalEvidence yet.

### GLS pre-advice
Remains supported through exact semantic parcel-number URL / label evidence. Conditional future delivery wording does not become a physical shipment event.

### MPL out-for-delivery
v1.2 adds exact tracking identity through the official Posta tracking namespace: official host + `/nyomkovetes/nyitooldal` + `ids=<identifier>`. The generic `ids` parameter remains invalid on all other hosts/paths.

### FOXPOST ready-for-pickup
Still unsupported by TechnicalEvidence v1.2 hard identity/event extraction. The useful evidence is in provider-labelled dual identifiers, redirect-wrapped URLs and QR payload. These require a carrier semantic adapter / redirect-safe strategy / QR layer, not weaker generic matching.

### DPD out-for-delivery
Still unsupported by TechnicalEvidence v1.2 hard identity/event extraction. The myDPD link's opaque `code` is not the parcel number; v1.2 correctly refuses to mislabel it as tracking. The next solution is an authenticated DPD template semantic adapter, not generic `code` parsing.

### Billingo invoice
Remains supported through invoice semantics in the HTML title plus authenticated provider provenance.

### Számlázz.hu invoice
v1.2 now consumes the explicit dedicated machine field `X-Szamlazz-Invoice`. It yields exact namespaced invoice identity plus invoice-event evidence. This is high-confidence structured evidence, not language inference.

### Merchant invoice + PDF
Still unsupported at hard field level by TechnicalEvidence v1.2. The attached PDF remains the strongest evidence source and is intentionally deferred to the PDF TechnicalEvidence layer.

## Safety conclusions

The v1.2 gain is obtained without broadening unsafe global patterns:

- generic `ids` still invalid except official Posta tracking namespace;
- generic `code` / `ref` still not tracking;
- Shopify platform fingerprint does not create an order event;
- WooCommerce order-table identity does not prove lifecycle state;
- UNAS internal trailing generator number is not order identity;
- provider-prefixed invoice header is accepted only because the header field itself explicitly types the value.

## Interpretation

On the same ten-case development set, targeted platform/provider semantics improve:

- commerce-specific support: **30% -> 60%**;
- explicit event support: **20% -> 30%**;
- hard identifier support: **10% -> 40%**.

These percentages are development coverage only, not production accuracy.

The four remaining unsupported families are informative:

1. Shopify order event/identity — platform known, lifecycle still needs stronger semantics;
2. FOXPOST — provider-labelled dual ids + redirect/QR;
3. DPD — authenticated carrier template with opaque access link;
4. merchant invoice — PDF is the real structured source.

## Next measurement/implementation gate

Before any production wiring:

1. add PDF TechnicalEvidence using the existing PDF text extraction stack;
2. add exact authenticated carrier semantic adapters for DPD and FOXPOST without generic number harvesting;
3. optionally add a Shopify notification-type discriminator only if a stable machine-level discriminator is proven across multiple templates;
4. rerun this development set;
5. expand to more already-reviewed provider families;
6. finally freeze a new untouched broad holdout before any accuracy/generalization claim.
