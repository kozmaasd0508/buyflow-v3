# TechnicalEvidence v1.5 — Retro Holdout v1 manual deterministic replay

Date: 2026-08-24

## Status

This is a **manual deterministic rule replay over the frozen 200-message Retro Holdout v1**, not a claim that GitHub Actions executed the private Gmail messages.

The private Gmail connector and the repository runtime do not share a direct data channel. Therefore this report deliberately distinguishes the verified rule replay from the already-CI-validated v1.5 measurement runner.

No extractor rule was changed while producing this report.

- Runtime AI calls: 0
- Production writes: 0
- Dataset: frozen 200 cases
- Ground truth: 33 commerce / 167 noise
- Mixed: 30 commerce / 70 noise
- Noise-enriched: 3 commerce / 97 noise
- Raw Gmail IDs, addresses, order/tracking/invoice values and message content: **not persisted here**

## Measurement definitions

### Event authority

A case is positive only when v1.5 emits an `event` TechnicalEvidence row.

For this replay, coarse TechnicalEvidence families are compared to the human lifecycle truth as follows:

- `order_created` -> ORDER_CREATED
- `shipment` -> shipment-lifecycle family (SHIPMENT_CREATED / SHIPPED / IN_TRANSIT / OUT_FOR_DELIVERY / READY_FOR_PICKUP)
- `delivery` -> DELIVERED
- `invoice_or_receipt` -> INVOICE

This is **family-level event authority**, not exact lifecycle-state accuracy, because v1.5 does not encode all shipment substates.

### Actionable technical evidence

A case is positive when v1.5 emits either:

- an `event`, or
- a hard identifier: `order_number`, `tracking_number`, `invoice_number`, `payment_reference`.

`platform`, `carrier`, `raw_signal`, amount/product evidence alone do **not** make a case positive. This avoids treating an authenticated carrier/security/marketing message as a BuyFlow purchase event merely because the carrier is known.

## Results

### Event authority

| Metric | Count |
|---|---:|
| True positive | 2 |
| False positive | 5 |
| False negative | 31 |
| True negative | 162 |
| Precision | 28.57% |
| Recall | 6.06% |
| F1 | 10.00% |

Confirmed true-positive cases:

- `mixed-006` — Express One physical-inbound/processing mail: English alternate layer supplies shipment lifecycle + air-waybill semantics.
- `mixed-084` — Számlázz.hu invoice mail: dedicated `X-Szamlazz-Invoice` header supplies invoice event/identity.

Confirmed false-positive event family:

- `mixed-064`
- `mixed-065`
- `mixed-072`
- `mixed-085`
- `mixed-086`

All five are seller-side FOXPOST **“Tömeges csomagfeladás visszaigazolása”** messages. Their HTML title satisfies the generic `feladás + visszaigazolás` title rule, even though these are the user's own outbound logistics and are `OTHER` in BuyFlow purchase-lifecycle truth.

### Actionable technical evidence

| Metric | Count |
|---|---:|
| True positive | 5 |
| False positive | 10 |
| False negative | 28 |
| True negative | 157 |
| Precision | 33.33% |
| Recall | 15.15% |
| F1 | 20.83% |

Confirmed true-positive actionable cases:

- `mixed-003` — FOXPOST buyer-side warehouse mail: explicit FOXPOST tracking identity.
- `mixed-006` — Express One processing mail: shipment event + air-waybill identifier.
- `mixed-010` — FOXPOST pre-advice: explicit tracking identity, intentionally no physical-shipment event yet.
- `mixed-070` — FOXPOST buyer-side pickup mail: explicit tracking identity.
- `mixed-084` — Számlázz.hu invoice: invoice event + invoice identity.

Confirmed false-positive actionable cases consist of two repeated seller-side FOXPOST families:

1. Generic title event false positives (`mixed-064`, `mixed-065`, `mixed-072`, `mixed-085`, `mixed-086`).
2. Returned customer parcels addressed back to the user's seller operation. These are `OTHER` for the purchase dashboard but contain explicit `Csomagod azonosítószáma` tracking labels, so the carrier adapter emits hard tracking evidence (`mixed-059`, `mixed-075`, `mixed-080`, `mixed-081`, `mixed-083`).

## Noise-enriched slice

The 100-case noise-enriched slice contains 97 noise and 3 real commerce emails.

All three real commerce cases are missed by frozen v1.5 actionable evidence:

- `noise-021` — YODEYMA / PrestaShop order confirmation. The stable order URL uses `id_order`, which v1.5 does not recognize, and the HTML title is generic.
- `noise-035` — AWGifts shipped mail. The shipment/order/tracking labels are Hungarian/custom; attached invoice layout does not satisfy the frozen generic PDF invoice parser contract.
- `noise-041` — AWGifts order received. The order identity appears in merchant-specific Hungarian prose rather than a supported technical identifier channel.

The slice therefore correctly demonstrates why Gmail `CATEGORY_PROMOTIONS` must never be used as a hard noise rule.

## Important misses confirmed in the mixed slice

The large false-negative count is structural, not random. Frozen v1.5 lacks or is too narrow for several real families found only after the freeze:

- Packeta native `tracking.packeta.com/?id=Z...` lifecycle.
- MPL real tracking URLs under `/ugyfelszolgalat/nyomkovetes?ids=...` (the frozen MPL adapter expects a narrower path).
- REGIO / `SiteEngine(c)GreyMatter` lifecycle.
- Shoprenter transport fingerprint such as authenticated `mail*.smtp.shoprenter.hu` for PCLAND.
- Temu `parent_order_sn` / Hungarian labelled Packeta tracking lifecycle.
- Vinted buyer logistics.
- AWGifts custom order/shipment wording.
- Frogpack/PPL shipment + invoice layout.
- Manual B2B order acceptance.

## Main conclusion

The 200-case retro holdout rejects the earlier development-slice impression that v1.5 had broad general coverage.

TechnicalEvidence remains the correct architecture, but **v1.5 is not production-ready as a commerce decision layer**:

1. recall is too low on unseen provider/template families;
2. generic evidence must be role-aware/direction-aware before becoming lifecycle authority;
3. provider-qualified URL/header/DOM/PDF adapters need broader family coverage;
4. the frozen future blind holdout must remain untouched while these fixes are developed on a separate branch.

## Highest-priority safety fix exposed by this benchmark

Before adding more recall, prevent seller-side logistics from becoming buyer purchase lifecycle:

`authenticated technical evidence + source-role/direction eligibility -> event/identity authority`

not

`technical cue -> purchase lifecycle event`.

This preserves the BuyFlow principle: **precision > recall**.
