# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read this after `BUYFLOW_HANDOFF.md`; older historical entries remain in `BUYFLOW_WORKLOG.md` and Git history.

## 2026-08-15 — Jatekbolt + AlzaBox recovery

### Jatekbolt `12247833`

- Blind-test backlog contained a real Jatekbolt Purchase whose financial fields were missing even though the original merchant email had full structured totals.
- Verified exactly one live Purchase `dfbe41c3-89f0-4f10-8dc8-e34923fba130` and exactly one delivered DPD Shipment, tracking `16380124260518`.
- Original email explicitly says it is receipt of the customer's purchase offer and not yet merchant acceptance.
- Added PR #84 `jatekbolt-order-received-v1`: exact `jatekbolt.hu`, matching subject/body order id, explicit offer-received/not-confirmed-yet wording, structured order section, and exact arithmetic reconciliation.
- Extracted: subtotal 52,775 HUF + DPD 750 - discount 5,280 = total 48,245 HUF; Klarna; DPD; Model & Hobby Kft.; confidence 0.995.
- Negative regressions cover lookalike domain, mismatched order ids, dispatch template and inconsistent money.
- PR #84 CI #440 passed after a test-only accent-normalization fix; merged runtime `c00cd8fff02f844ad9938d99df123ed732930148`; main CI #441 and exact Render smoke #335 passed.
- Live 30-day targeted rerun: 2 checked / 2 processed / 0 review / 0 unlinked / no new Purchase/Shipment/Document writes / AI 0.
- Existing Purchase was enriched to 48,245 HUF, Klarna pending, DPD while remaining delivered; no duplicate created.
- Jatekbolt invoice email remains REVIEW. PDF inspection showed invoice `S26_044783`, order reference `JB12247833`, total 48,248 HUF and Model & Hobby Kft. Current Nylas deterministic runtime does not ingest attachment bytes/content, so no automatic document was created from filename/timing alone.

### Alza `602385238`

- Found three trusted unlinked Alza lifecycle emails with no Purchase: processing `2026-06-24`, delayed `2026-06-25`, AlzaBox ready-for-pickup `2026-06-26`.
- No carrier tracking exists because fulfillment is internal AlzaBox.
- Processing email provides exact order/reference 602385238, explicit no-contract-yet wording, two agreeing totals 3,350 HUF, invoice identity `AHUW261747843`, AlzaBox, card at pickup/online, Alza.hu Kft.
- Existing exact 90-day scan proved 4 checked / purchaseWrites 0 / AI 0.
- PR #85 introduced `alza-order-processing-v2` and `Alza Internal Fulfillment Recovery V1` while preserving lightweight v1 processing fallback.
- Recovery requires rich trusted V2 processing + separate delayed + separate ready-for-pickup + same user/connection/order + <=14 days + exact completed 90-day proof + no trusted order_created + no existing exact Purchase.
- Future matching cases schedule their own deduped 90-day proof. No Shipment is invented without tracking; ordered_at remains null; `AHUW...` remains evidence rather than an invented document.
- PR #85 initially had two CI feedback loops: first preserved the legacy processing fallback; second corrected new tests so weak rich evidence falls back to v1 without financial trust rather than becoming null. Final PR CI #444: 353/353 API tests green. Runtime `699e2fba7566b7430e4c2bc5e3a5d54dab7e4ac6`; main CI #445 and exact Render smoke #339 passed.
- First live proof scan reparsed the rich source to `alza-order-processing-v2` but normal processing marked sources `processed` before the specialized recovery pass. No Purchase was created; this exposed a safe false negative.
- PR #86 fixed recovery eligibility to use trusted V2 evidence independent of audit processing status, explicitly mapped DB snake_case Purchase rows to resolver camelCase identity, fixed early existing-Purchase scheduling guard, and retained the final exact DB duplicate check.
- PR #86 CI #446 passed; runtime `8b4461ce836c1e1e9e1f0c0813779fdcda3acbbe`; main CI #447 and exact Render smoke #341 passed.
- Final live Purchase `661865f5-23dd-4c26-97dd-1059f533566b`: Alza.hu / Alza.hu Kft., order 602385238, 3,350 HUF, payment pending, `Kártya átvételkor vagy online`, shipping method AlzaBox, expected carrier null, current state ready_for_pickup, ordered_at/shipped_at/delivered_at null, confidence 0.99.
- Integrity: exactly 1 Purchase, exactly 0 Shipments, 3 linked validated+processed sources, 0 documents, AI 0.

### Current live counters

- REVIEW 35
- unlinked 10
- unresolved total 45
- historical AI runs 98
- latest AI run `2026-08-14 21:43:08.694227+00`.

### Next default target

Continue real physical-commerce clusters first. Investigate remaining DPD tracking `16380124260338` and nearby merchant evidence before payment-only or obvious subscription/promo noise. Keep Jatekbolt invoice REVIEW until attachment/PDF ingestion exists; keep McDonald's short POS ids REVIEW until safe local-order identity exists.
