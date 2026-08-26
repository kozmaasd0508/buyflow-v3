# TechnicalEvidence v1.1 — Real Gmail development remeasurement

**Date:** 2026-08-23  
**Mode:** development ground truth / shadow only  
**Production writes:** 0  
**AI calls:** 0

## Scope

Remeasure the same six already-reviewed real Gmail commerce cases used by the v1 preflight. This is regression/development evidence, **not** a fresh blind holdout and not an accuracy claim.

Cases remain privacy-safe and are described only by family/event:

1. merchant order confirmation;
2. merchant shipment/sent notice;
3. carrier processing/inbound notice;
4. carrier out-for-delivery notice;
5. carrier delivered notice;
6. merchant invoice notice.

No raw Gmail ids, subjects, bodies, addresses, order ids, tracking ids or invoice ids are stored here.

## v1 -> v1.1 coverage

| Metric | v1 | v1.1 |
|---|---:|---:|
| cases inspected | 6 | 6 |
| auth/transport technical evidence | 6/6 | 6/6 |
| commerce-specific technical evidence | 3/6 | **6/6** |
| hard identifier technical evidence | 1/6 | **3/6** |
| explicit event technical evidence | 2/6 | **6/6** |
| JSON-LD in this slice | 0/6 | 0/6 |

## What changed

v1.1 is additive and keeps all v1 evidence. It adds two generic machine-semantic extractor families:

### Composite template/provider tags

Exact normalized semantic tags now map to lifecycle events without merchant-specific code, including:

- `order-confirm` -> `order_created`
- `order-sent` / equivalent shipped/dispatch forms -> `shipment`
- `order-invoice` / order receipt forms -> `invoice_or_receipt`
- exact payment/delivery composite forms where present

Unknown campaign/template tags produce no event claim.

### Labelled English machine semantics

Current-message-only parsing now recognizes strict labelled identifiers:

- `shipment ID`
- `air waybill`
- `parcel number`
- shipment-context `following ID`
- `order number`
- `invoice number`

and explicit lifecycle statements such as:

- shipment/package `has been delivered`
- `begun/began/started processing of ... parcel/shipment/package`
- `driver/courier is going to / will deliver`
- explicit shipped/dispatched statements
- explicit invoice/receipt ready/issued/created statements

Quoted/forwarded history is excluded using the existing current-message boundary logic.

## Real six-case result

- merchant order confirmation: existing HTML title evidence remains `order_created`;
- merchant sent notice: previously missed composite tag now yields `shipment`;
- carrier processing notice: English processing lifecycle + labelled air-waybill now yield `shipment` + exact tracking identity;
- carrier out-for-delivery notice: delivery-day English lifecycle + shipment-context ID yield `shipment` + exact tracking identity;
- carrier delivered notice: `shipment ID` + `has been delivered` yield tracking identity + `delivery`, in addition to the existing tracking URL evidence;
- merchant invoice notice: composite `order-invoice` tag now independently yields `invoice_or_receipt` in addition to the existing HTML title evidence.

## Safety / negative result

The improvement does **not** come from accepting generic bare identifiers.

The v1.1 tests explicitly reject bare examples such as:

- `ID: 123456789`
- `Reference: 123456789`

unless a stronger semantic label/context qualifies the value. Generic `ref` URL parameters also remain unsupported without host/provider qualification.

## Interpretation

The same development slice moves from **3/6 -> 6/6 commerce-specific technical coverage**, **2/6 -> 6/6 explicit event coverage**, and **1/6 -> 3/6 hard identifier coverage** while preserving the 0-write / 0-AI shadow boundary.

This validates the next architectural direction: machine-readable/header/alternate-language evidence can materially improve coverage before visible-language fallback. It still does **not** authorize automatic Purchase linking or production writes.

## Next measurement gate

1. keep v1.1 shadow-only;
2. run the privacy-safe Real Gmail side-by-side harness against a broader already-reviewed development set across webshop engines, carriers and invoice providers;
3. measure exact GT support, contradictions and baseline rescue counts;
4. then freeze a **new untouched blind set** before any further tuning/generalization claim;
5. only after that consider feeding reviewed TechnicalEvidence into canonical event resolution, never directly into unsafe identity merge.
