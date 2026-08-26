# TechnicalEvidence v1 — Real Gmail development measurement

**Date:** 2026-08-23  
**Mode:** development ground truth / shadow only  
**Production writes:** 0  
**AI calls:** 0

## Scope

First RAW-layer preflight over six already-reviewed real Gmail commerce cases. These messages are DEVELOPMENT/REGRESSION material, not a fresh blind holdout.

The six cases cover:

1. merchant order confirmation (Sportvision);
2. merchant shipment/sent notice (GymBeam);
3. carrier processing/inbound notice (Express One);
4. carrier out-for-delivery notice (Express One);
5. carrier delivered notice (Express One);
6. merchant invoice notice (GymBeam).

No raw subject/body/address/order/tracking/invoice values are stored in this document.

## Preflight result for current TechnicalEvidence v1 collector

- cases inspected: **6**
- authentication/transport technical evidence present: **6/6**
- commerce-specific technical evidence found by v1: **3/6**
- hard identifier technical evidence found by v1: **1/6**
- structured JSON-LD evidence in this six-case slice: **0/6**
- explicit event evidence found by v1: **2/6**
- explicit tracking identifier evidence found by v1: **1/6**

### Positive evidence

- Sportvision order confirmation: HTML `<title>` contains a stable order-confirmation semantic, producing `event=order_created` evidence.
- Express One delivered: direct tracking URL contains semantic `trackingNr=...`, producing high-confidence tracking identity evidence.
- GymBeam invoice: HTML `<title>` contains invoice semantics, producing `event=invoice_or_receipt` evidence.
- All six cases contain useful authentication/transport provenance (DKIM/SPF/Return-Path/Received-family evidence), but these signals alone do not establish commerce event identity.

### Important misses exposed by the measurement

The current v1 collector does **not** yet consume several strong machine-oriented signals that are present in the real messages:

1. `X-Mailin-Tag: order-sent` is present on GymBeam shipment mail, but `order-sent` is not mapped to shipment by the current event-token vocabulary.
2. `X-Mailin-Tag: order-invoice` is present on GymBeam invoice mail, but the composite tag itself is not mapped; invoice is currently recovered only through the HTML title.
3. Express One processing mail contains a stable English alternate-language lifecycle description and an air-waybill label, but v1 does not parse alternate-language body semantics.
4. Express One out-for-delivery mail contains stable English delivery wording plus the shipment identifier, but v1 does not parse that machine-like alternate-language body layer.
5. Express One delivered mail contains explicit `has been delivered` wording; v1 currently gets the tracking identifier from `trackingNr`, but not the delivery event from the alternate English body.
6. Generic URL parameter aliases such as broad `ref` cannot safely be accepted without host/provider qualification; they remain intentionally unsupported.

## Interpretation

The architecture is validated: technical layers contain stable, auditable information and can add independent provenance. However, **TechnicalEvidence v1 is not yet broad enough to claim a recall improvement over Extraction Engine v2.**

The first version is therefore kept shadow-only. It must not be wired into Purchase Identity Graph decisions yet.

## Measurement harness added

`technical-evidence-real-gmail-measurement-v1.ts` now provides a privacy-safe side-by-side evaluator for private Real Gmail GT cases. It measures:

- exact technical support by GT field;
- contradictory technical support;
- baseline Extraction Engine v2 missing/conflict fields;
- fields where exact TechnicalEvidence could rescue a baseline miss;
- per-case source/identifier coverage without returning raw values.

The returned report contains opaque case IDs and aggregate statuses only.

## Safest next iteration

TechnicalEvidence v1.1 should stay shadow-only and add **generic machine-semantic support**, not merchant-specific patches:

1. composite provider/template event tags (`order-confirm`, `order-sent`, `order-invoice`, equivalent normalized forms);
2. alternate-language semantic labels for order/shipment/delivery/invoice identities and lifecycle events;
3. labelled English identifiers such as `shipment ID`, `air waybill`, `parcel number`, `order number`, `invoice number`;
4. provider/host-qualified URL aliases only where a generic alias would otherwise be unsafe;
5. preserve exact sourcePath/provenance for every new claim.

After v1.1, rerun the same development cases, then use a new untouched set for any blind/generalization claim.
