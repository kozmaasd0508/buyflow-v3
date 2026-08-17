# GLS Hungary — 46-conflict review

Status date: **2026-08-17**

This review closes the 46 semantic conflicts attributed to `carrier.hu.gls@1.0.0-test.1` in the 2026-08-17 read-only cross-parser mailbox audit.

## Safety scope

- This review is read-only.
- It does not register GLS in the production protocol registry.
- It does not enable Purchase, shipment, payment, document, return, refund, warranty, or delivery writes.
- It does not change database schema or runtime write gates.

## What the 46 conflicts are

Direct Gmail review reproduced **exactly 46 messages** in the two-year audit window with the same authenticated/template family:

- sender: `noreply@gls-hungary.com`
- subject: `GLS csomag információ / GLS parcel information`
- body says the GLS partner **prepared the parcel for the recipient**
- body contains the future-looking label **`Kézbesítés várható`**
- the message carries a GLS parcel number

Private message IDs, recipient data, addresses, parcel numbers, PINs, merchant names and amounts are intentionally not stored in this review.

The 46 rows are therefore **one repeated semantic disagreement**, not 46 unrelated failure modes.

## Adjudication

| Layer | Result |
|---|---|
| GLS protocol shadow | `SHIPMENT_CREATED` |
| GLS-specific deterministic parser (`gls-lifecycle-v1`) | `shipment_created` |
| Generic deterministic carrier comparator | `OUT_FOR_DELIVERY` |
| Reviewed meaning | **`SHIPMENT_CREATED`** |

The message explicitly says the partner prepared the parcel and describes delivery as a later/future event. It does **not** prove physical GLS possession, movement through the GLS network, or that the courier is attempting delivery that day.

Therefore the conservative protocol result is correct:

`SHIPMENT_CREATED != SHIPPED != OUT_FOR_DELIVERY`

## Why the one-off comparator disagreed

The generic carrier parser in `apps/api/src/ingestion/deterministic-commerce-parser.ts` contains a broad future-delivery pattern for `kézbesítés várható`. `detectCarrierShipmentPhase()` evaluates future-delivery patterns before generic pre-advice patterns, so these GLS pre-advice messages can be promoted to `out_for_delivery` in that standalone comparator path.

The 2026-08-17 cross-parser consensus audit deliberately called the generic `parseDeterministicCommerceEmail()` function as an independent comparison signal. The audit documentation already states that this comparator is **not ground truth**.

## Why the real BuyFlow Nylas path is safer

The actual deterministic Nylas preprocessing path does not start with the generic carrier parser for GLS. `preprocessDeterministicNylasMessage()` first calls `preprocessGlsCarrierNylasMessage()`. The GLS-specific parser recognizes this exact pre-advice family and returns `shipment_created`; only unmatched messages fall through to the generic deterministic parser.

This means the 46 audit conflicts identify a **comparator-path semantic overreach**, not evidence that the GLS protocol profile is too aggressive.

## Closure decision

All 46 GLS conflicts are reviewed as the same non-dangerous boundary disagreement:

- shadow/profile result remains `SHIPMENT_CREATED`;
- `DO_NOT_SET_SHIPPED_AT` remains mandatory;
- `DO_NOT_MARK_IN_TRANSIT` remains mandatory;
- `DO_NOT_MARK_DELIVERED` remains mandatory;
- no production write is enabled;
- any future GLS conflict outside this reviewed fingerprint re-opens the gate.

With this conflict set closed, `carrier.hu.gls` is eligible to move from **YELLOW** to **GREEN production-shadow candidate** status. GREEN still means observations/counters only and does not authorize state mutation.

## Regression coverage

A dedicated regression test pins the reviewed Gmail wording, including `Kézbesítés várható`, to `SHIPMENT_CREATED` in both the GLS-specific deterministic parser and the protocol shadow layer.
