# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous latest entries are preserved in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-16 — user-supplied 100-email blind benchmark

### Source / goal

The user uploaded `buyflow_demo_emails_100(1).xlsx` to stress-test BuyFlow with many complete purchase journeys rather than only isolated email samples.

Workbook structure:
- 100 emails total
- 70 purchase/lifecycle messages
- 30 noise/hard negatives
- 10 purchase threads
- 20 event labels
- merchants: Alza, eMAG, Notino, Amazon.de, MediaMarkt, ABOUT YOU, IKEA, iStyle, Decathlon, SHEIN
- carriers: GLS, Express One, DPD, DHL, Packeta, MPL, Foxpost, plus store pickup

The corpus covers order created, payment success/failure/action-required, processing, packing, pre-advice, shipped, in-transit, out-for-delivery, ready-for-pickup, delivery failure, delivered, cancel, return, refund, warranty and invoice.

The workbook deliberately uses reserved demo carrier senders such as `gls-demo.example`. Those domains were never added to production trust. The benchmark normalizes them only inside the test to already trusted carrier identities, so it measures parser semantics without weakening sender security.

### PR #97 — first blind run

Branch `agent/user-100-email-benchmark-v1`.

First blind CI #477 ran the current deterministic core before parser changes. It failed usefully.

Machine safety findings:
- 30/30 noise messages stayed out of deterministic commerce/lifecycle parsing
- zero wrong order/tracking identities
- zero lifecycle messages promoted to `order_created`
- **six SHIPPED messages were incorrectly classified as delivery**
- **three SHIPMENT_CREATED/pre-advice messages were recognized without an explicit phase**

Affected SHIPPED fixtures were GLS, DPD, DHL, Packeta, Foxpost and Express One. Their body used the legitimate sender-side sentence `A küldeményt a futár átvette a feladótól.` The generic delivery detector normalized `átvette` to `atvette` and treated the bare word as delivery, even though the recipient had not received anything.

The phase problem was also real: `shipment-resolution.ts` considered any `eventType=shipment` with phase other than `shipment_created` physical progress. Therefore `phase=null` silently counted as physical carrier evidence.

### Safety fix

The benchmark was not weakened.

`deterministic-commerce-parser.ts` now:
- removes bare `átvette` as delivery proof
- keeps explicit delivered wording (`sikeresen kézbesítettük`, delivered-success language, recipient-specific receipt)
- detects strong generic carrier phases:
  - pre-advice / label created -> `shipment_created`
  - carrier picked up from sender -> `shipped`
  - delivery-today / courier-out wording -> `out_for_delivery`
  - explicit completed delivery -> `delivered`
- returns delivery event only for explicit `delivered` phase

`shipment-resolution.ts` now counts physical shipment evidence only for explicit phases:
- `shipped`
- `in_transit`
- `out_for_delivery`
- `ready_for_pickup`

`shipment_created` and `phase=null` are non-physical by default.

Added regressions for:
- sender pickup is shipped, never delivered
- pre-advice is shipment_created
- delivery-today is out_for_delivery, never delivered
- explicit completed delivery remains delivered
- phase-less shipment cannot prove physical progress

### Final PR result

PR #97 final head `7480e8efefe5fd64b361eb547fe04ad71ba7aa3b`.
- final PR CI #481: **376/376 API tests passed**
- API build green
- mobile typecheck green
- mobile web build green
- merged runtime main: `994be825f3f91b329ced10080bdb8dae43c9492e`
- main CI #482 green
- exact Render smoke #376 green for exact `994be825...` runtime

### Final 100-email machine report

Safety:
- fixtures: 100
- purchase-related: 70
- noise: 30
- noise parser matches: **0**
- wrong order/tracking identity: **0**
- unsafe lifecycle promotion: **0**
- recognized pre-advice without explicit `shipment_created`: **0**

Exact newly covered carrier semantics:
- SHIPMENT_CREATED: **3/4**
- SHIPPED: **6/6**

The one missing SHIPMENT_CREATED case is the synthetic MPL demo wording. Real MPL handling intentionally requires the stricter official sender/syntax path and was not loosened for the benchmark.

Current generic corpus coverage after safety fixes:
- recognized purchase-related fixtures: **9/70**
- exact semantic matches across whole workbook: 39/100, of which 30 are correctly rejected noise and 9 are exact purchase/carrier events

This number must not be presented as overall production BuyFlow recall. The workbook is deliberately adversarial/new and much of it uses generic lifecycle language not yet covered by the merchant-specific production adapters.

### Coverage gaps exposed by the workbook

Priority order for future safe deterministic work:
1. generic order confirmation sentence `Rögzítettük a(z) <id> azonosítójú megrendelést`
2. payment success / payment failed / action required with stable order identity
3. processing / packing / cancellation lifecycle
4. transit/out-for-delivery/delivered carrier messages where tracking is present but not in current explicit label form
5. ready-for-pickup and store-pickup
6. return / refund / warranty
7. invoice email anchors; keep PDF attachment ingestion separate
8. strict MPL handling

Do not optimize the benchmark score by adding broad catch-all rules. Each new rule must keep false Purchase = 0, wrong auto-link = 0 and ambiguity => REVIEW.

### Previous recent work

Immediately before this benchmark:
- PR #95 added 24 web-derived unseen notification fixtures and fixed a second carrier lookalike-domain path.
- PR #93 added the original 31-email demo benchmark and fixed Spanish order-id extraction plus carrier-domain identity hardening.
- private PDF ingestion/opening is live; Jatekbolt `S26_044783.pdf` remains the proven document case.

See Git history and `BUYFLOW_WORKLOG.md` for the full older chronology.
