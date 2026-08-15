# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled runtime code commit:** `e320ac5593f95f6535c97b865f569c9d7bbde181`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Reconcile this snapshot with current `main`, live Supabase and the latest exact Render deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns chaotic purchase, delivery, invoice, warranty and return emails into one safe Purchase record.

- Frontend/mobile web: `apps/mobile`, Render `/app/`; Android packaging only when explicitly requested.
- API/backend: TypeScript in `apps/api`.
- Database/auth: Supabase production `acjenqkrvnkdvvgordry`, eu-west-1.
- Email ingestion: Nylas webhook + durable full-inbox/targeted scan jobs.
- Recognition: deterministic-first; uncertain evidence => REVIEW.
- AI infrastructure exists but **AI is intentionally disabled**. Historical `ai_processing_runs` remains **98**; latest AI run `2026-08-14 21:43:08.694227+00`.
- Production flow: branch -> PR -> CI -> merge -> main CI -> exact Render smoke.

## NON-NEGOTIABLE SAFETY

1. Purchase creation != lifecycle.
2. Multiple plausible candidates => REVIEW, never unsafe auto-link.
3. Strong identity first: order ID, tracking identity, then narrow corroborated fallbacks.
4. “Delivery today” is not delivered without explicit completion evidence.
5. Gmail categories are advisory only; never a gate.
6. Shared/public mailbox domains cannot alone establish merchant identity.
7. Carrier/payment evidence may update only an existing uniquely corroborated Purchase or pass an explicitly hardened historical lane.
8. `shipment_created` / packing / pre-advice may anchor a carrier relationship but **must not define physical `shipped_at`**.
9. Browser-first UI; APK only on explicit request.
10. Supabase DDL via migrations; guarded DML is allowed for verified historical repair.

## MULTI-GMAIL / BLIND TEST

Multi-Gmail + per-account 7/30/90 deterministic full scans are live. Relevant PRs: #69–#76.

Second Gmail 30-day blind scan:
- pages 3
- checked 149
- ignored 130
- REVIEW 14
- unlinked 5
- Purchase writes 0
- Shipment writes 0
- Document writes 0
- AI 0

Safety result: zero false automatic Purchases. Real misses are being converted into reusable deterministic rules rather than one-off hard-codes.

## COMPLETED: ALL IN PACKAGING / GLS

PR #78 runtime `ebe06d3ee8c6c203bc363ed58eb992670758f667` extended the existing strict historical reconstruction lane.

Live order `148810`:
- exactly 1 Purchase, All In Packaging / `allinpackaging.com`
- 16,670 HUF, COD, GLS
- exactly 1 Shipment, tracking `3219379224`, `in_transit`
- no invented ordered_at
- separate no-COD GLS tracking `3219379250` remains unlinked intentionally
- AI 0.

Historical reconstruction remains gated by a completed 90-day exact-order negative proof with `purchaseWrites=0`.

## COMPLETED: GYEREKJATEKBOLT FAILED PAYMENT / CANCELLATION

Real order `535574`, Purchase id `ceefcd70-1b01-4c0b-94ee-3b23cb05da0e`, total 14,660 HUF.

The current deterministic lifecycle parser already contained the required rules; no code change was necessary. A 30-day targeted rerun produced:
- checked 5
- processed 4
- REVIEW 1
- unlinked 0
- writes 0
- AI 0.

Final Purchase state:
- `payment_status=failed`
- `current_state=cancelled`
- `cancelled_at=2026-08-04 11:21:36+00`
- `paid_at=null`
- no Shipment.

The standalone “Bankkártyás fizetés link” retry/action mail remains REVIEW intentionally; a payment retry link alone is not a final transaction state.

## INTENTIONALLY REVIEW: MCDONALD'S POS / LOCAL ORDER IDS

Four real McDonald's payment-summary emails were inspected. They include restaurant, date/time, amount, card and a short 4-digit restaurant order number, but explicitly state that the email is only an order summary and the receipt is provided at pickup.

Current Purchase uniqueness uses `(user_id, merchant_domain, order_number)`. A short local/POS number such as `6356` can repeat over time, so these emails are **not** promoted to Purchase creation. No separate receipt email was found.

Required future architecture: a POS/local-order identity that can safely incorporate merchant/location/time (or another stable provider ID) instead of treating a reusable 4-digit number as a global merchant order ID. Until then REVIEW is correct.

## COMPLETED: SZIDIBOX / MPL

Blind-test backlog exposed a real Szidibox purchase sent from public mailbox `szidibox@gmail.com` plus an MPL carrier chain.

Historical Purchase before repair:
- id `24b05d2e-be2c-4ea8-9836-befce30b4ddd`
- order `SO-2024-30411`
- total 26,388 HUF
- COD
- old incorrect merchant domain `gmail.com`
- no Shipment initially.

### PR #80 — MPL + public-mailbox safety

Main runtime `3d53c3cefb61d9c2452cb9f677214fc32c0cf22d`.
- `posta.hu` is a carrier sender domain.
- Exact MPL sender is `kozponti.ertesites@posta.hu`.
- Deterministic MPL states:
  - `Csomagot adtak fel neked` => `shipped`
  - `Csomagod a kézbesítőnél van` => `out_for_delivery`
  - `Csomagod a postán átvehető` => `ready_for_pickup`
- extracts tracking, parcel sender and COD.
- MPL labels normalize to carrier slug `mpl`.
- narrow Szidibox packing anchor requires exact `szidibox@gmail.com`, `kartonshop.hu` evidence, matching `SO-...` order ID and explicit future courier handoff; it emits only `shipment_created`.
- generic Purchase creation now blocks public-mailbox domains such as Gmail/Outlook/Yahoo even with corroborating messages; unverified public mailbox evidence stays REVIEW.
- PR CI #429, main CI #430, exact Render smoke #324 passed.

### PR #81 — physical shipped_at + flattened MPL parsing

Main runtime `5139fda8bcad1f743aef37b49340bef93ca446e4`.
- `shipment_created` merchant anchor cannot define physical Shipment `shipped_at`.
- physical `shipped_at` comes from first carrier-side physical progress.
- if only pre-advice exists, no physical shipped timestamp is emitted.
- MPL parser now accepts Nylas flattened label layout in addition to line-based text.
- PR CI #433, main CI #434, exact Render smoke #328 passed.

Final live MPL rerun:
- 3 checked / 3 processed / 0 REVIEW / 0 unlinked / AI 0
- all three sources parser `deterministic-lifecycle-v1`
- phases `shipped -> out_for_delivery -> ready_for_pickup`
- tracking `PB9S650307180`
- parcel sender `Szidibox Karton Kft.`
- COD 26,390 HUF
- confidence 0.995 each.

### PR #82 — MPL display name

Runtime `e320ac5593f95f6535c97b865f569c9d7bbde181`.
- carrier slug remains `mpl`
- display name canonicalized to `MPL`
- PR CI #435, main CI #436, exact Render smoke #330 passed.

### Final Szidibox live state after guarded historical repair

Purchase:
- id `24b05d2e-be2c-4ea8-9836-befce30b4ddd`
- merchant `Szidibox Karton Kft. Webáruház`
- legal name `Szidibox Karton Kft.`
- merchant domain repaired to `kartonshop.hu`
- order `SO-2024-30411`
- total 26,388 HUF
- payment `cash_on_delivery`
- expected carrier `MPL`
- state `ready_for_pickup`
- ordered_at `2026-07-22 13:38:20+00`
- shipped_at corrected to first physical MPL acceptance `2026-07-23 14:44:56+00`
- delivered_at null
- confidence 0.96.

Shipment:
- id `f6ed4ca1-7750-4d48-99ee-3ece45a5213c`
- carrier `MPL`, slug `mpl`
- tracking `PB9S650307180`
- status `ready_for_pickup`
- shipped_at `2026-07-23 14:44:56+00`
- last_event_at `2026-07-24 11:46:49+00`
- delivered_at null
- 4 shipment source links.

Integrity: exactly 1 Purchase and exactly 1 Shipment for this identity. The historical repair changed exactly one Purchase row and one Shipment row.

### Remaining public-mailbox architecture gap

The system is now safe against creating new `merchant_domain=gmail.com` Purchases. However, future new merchants that legitimately send from public mailboxes still need an explicit **verified merchant identity layer** (`public mailbox -> business domain/legal entity`) before they can auto-create Purchases. Until implemented, those new cases should remain REVIEW rather than guess.

## OTHER COMPLETED DETERMINISTIC COVERAGE

- Gate.shop / Foxpost ready-for-pickup.
- Scitec / BioTechUSA / Foxpost verified legal-entity COD bridge.
- Ars Una / GLS parcel-sender + COD bridge.
- Allegro / HappyBox24 lifecycle + DPD + seller invoice.
- GymBeam / Express One processing, historical reconstruction and terminal receipt resolution.
- promotional/repurchase hard negatives.
- Express One outbound pickup-noise exclusion.
- Limone merchant parsing.

Three Barion successful-payment emails remain intentionally unlinked because payment-only evidence is insufficient to create a Purchase.

## CURRENT LIVE BACKLOG

Verified after Gyerekjatekbolt and Szidibox/MPL cleanup:
- REVIEW: **35**
- unlinked: **13**
- total unresolved: **48**
- historical AI runs: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`

This is a richer two-mailbox test dataset, not by itself a regression.

## FRONTEND STATE / REMAINING UI WORK

Live: login, purchase list/detail, current state + next action, timeline, product edit/remove, order/tracking/document details, targeted recovery, multi-Gmail settings and 7/30/90 full scans.

Still lagging:
- top-level lifecycle labels/counting in `main.ts` need full `in_transit` / `out_for_delivery` / `ready_for_pickup` alignment,
- Warranty UI,
- Return/refund UI,
- Felfedezés.

AI audit/Flow stays hidden while AI is disabled.

## NEXT ACTION

If the user gives no different direction:

1. Continue the remaining **35 REVIEW + 13 unlinked** clusters, prioritizing genuine purchase false negatives over obvious noise.
2. Implement only reusable safe rules with negative regressions; never hard-code individual order/tracking IDs.
3. Keep McDonald's/POS short local IDs in REVIEW until a proper local/POS identity model exists.
4. Add a verified public-mailbox merchant identity layer before allowing future Gmail-sender merchants to auto-create Purchases.
5. After recognition backlog improves, align top-level lifecycle labels/counters, then Warranty + Return/refund UI, later Felfedezés.
6. Keep weak payment-only evidence unlinked unless merchant corroboration appears.

## TEST QUALITY TARGET

- target >=95% true purchase recognition across multiple mailboxes/merchants/carriers,
- false automatic Purchase = 0,
- wrong automatic link = 0,
- duplicate Purchase/Shipment = 0,
- REVIEW is preferred over a wrong automatic match.

## WORKFLOW PREFERENCES

- Prefer implementation/live verification over theory.
- Keep user-facing updates short and concrete.
- Do not repeatedly ask for confirmation when direction is clear.
- Browser first; APK only on explicit request.
- Report exact PR, commit, CI/deploy, live writes, AI calls and remaining backlog.

## MAINTENANCE

This is a rolling snapshot, not a diary. After meaningful work update it and prepend concise detail to `BUYFLOW_WORKLOG.md`. Never store secrets, credentials or raw customer email bodies here.
