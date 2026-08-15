# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file. Also read `BUYFLOW_WORKLOG_LATEST.md` for the newest detailed recovery notes before the older `BUYFLOW_WORKLOG.md` history.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled runtime code commit:** `8b4461ce836c1e1e9e1f0c0813779fdcda3acbbe`  
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
- AI is intentionally disabled. Historical `ai_processing_runs` remains **98**; latest AI run `2026-08-14 21:43:08.694227+00`.
- Production flow: branch -> PR -> PR CI -> merge -> main CI -> exact Render smoke -> live DB verification.

## NON-NEGOTIABLE SAFETY

1. Purchase creation != lifecycle.
2. Multiple plausible candidates => REVIEW, never unsafe auto-link.
3. Strong identity first: order ID, tracking identity, then narrow corroborated fallbacks.
4. “Delivery today” is not delivered without explicit completion evidence.
5. Gmail categories are advisory only; never a gate.
6. Shared/public mailbox domains cannot alone establish merchant identity.
7. Carrier/payment evidence may update only an existing uniquely corroborated Purchase or pass an explicitly hardened historical lane.
8. `shipment_created` / packing / pre-advice may anchor a relationship but must not define physical `shipped_at`.
9. Browser-first UI; APK only on explicit request.
10. Historical reconstruction must never invent order date, tracking, carrier or document identity that the evidence does not contain.
11. Supabase DDL via migrations; guarded DML is allowed for verified historical repair.

## MULTI-GMAIL / BLIND TEST

Multi-Gmail + per-account 7/30/90 deterministic full scans are live. The second Gmail 30-day blind scan checked 149 messages with zero false automatic Purchases. Real misses are being converted into reusable deterministic rules rather than one-off hard-codes.

## COMPLETED: JATEKBOLT ORDER `12247833`

Live Purchase:
- id `dfbe41c3-89f0-4f10-8dc8-e34923fba130`
- merchant JatekBolt.hu / `jatekbolt.hu`
- order `12247833`
- exactly 1 Purchase and 1 delivered DPD Shipment
- DPD tracking `16380124260518`
- final state `delivered`
- ordered_at `2026-08-02 16:49:02+00`
- shipped_at `2026-08-04 08:36:08+00`
- delivered_at `2026-08-05 05:54:33+00`.

### PR #84 — strict Jatekbolt order-received parser

Runtime `c00cd8fff02f844ad9938d99df123ed732930148`.

Parser `jatekbolt-order-received-v1`:
- exact `jatekbolt.hu`,
- subject/body order ID must agree,
- explicitly recognizes that the email is only receipt of the customer's purchase offer and **not yet merchant acceptance**,
- requires the structured order details section,
- requires arithmetic reconciliation `subtotal + shipping - discount = total`,
- extracts subtotal **52,775 HUF**, DPD **750 HUF**, discount **5,280 HUF**, total **48,245 HUF**, Klarna, DPD, Model & Hobby Kft., confidence 0.995,
- dispatch messages are not reclassified as new order-received events,
- lookalike domain, mismatched order IDs and inconsistent money are rejected.

PR #84 CI passed after a test-only accent-normalization fix; main CI #441 and exact Render smoke #335 passed.

Live targeted rerun `12247833`:
- 2 checked / 2 processed / 0 REVIEW / 0 unlinked / 0 new writes / AI 0.
- Same existing Purchase was financially enriched to 48,245 HUF, Klarna pending, DPD, without changing delivered lifecycle state.

### Jatekbolt invoice intentionally not auto-linked yet

Invoice email source remains REVIEW. Its PDF `S26_044783.pdf` was inspected:
- invoice `S26_044783`
- order reference `JB12247833`
- MODELL & HOBBY Kft.
- total **48,248 HUF**
- DPD 750 HUF
- discount differs by 3 HUF from the order summary due invoice-level rounding.

Current Nylas runtime exposes attachment metadata but does not ingest PDF bytes/content into the deterministic pipeline. Do **not** link this document from filename/timing alone. Future work: safe attachment/PDF ingestion with document identity extraction.

## COMPLETED: ALZA INTERNAL ALZABOX ORDER `602385238`

Initial blind-test state: no Purchase existed. Three trusted Alza sources were unlinked:
1. processing `2026-06-24 15:46:47+00`
2. delayed `2026-06-25 09:27:20+00`
3. AlzaBox ready-for-pickup `2026-06-26 10:10:28+00`.

There is **no carrier tracking** because this is internal AlzaBox fulfillment.

The processing email contains:
- exact order/reference `602385238`
- explicit statement that no contract exists yet and a later email will confirm contract formation
- two agreeing totals: **3,350 HUF**
- invoice identity `AHUW261747843`
- AlzaBox fulfillment
- card at pickup or online
- legal entity Alza.hu Kft.

A completed exact 90-day search proved:
- checked 4
- purchaseWrites 0
- AI 0
- no hidden order-created Purchase.

### PR #85 — Alza Internal Fulfillment Recovery V1

Runtime `699e2fba7566b7430e4c2bc5e3a5d54dab7e4ac6`.

- Adds strict `alza-order-processing-v2` while keeping event `order_updated`, lifecycle `order_processing`; it is **not** promoted to normal order confirmation.
- Preserves the older lightweight Alza processing fallback for less detailed messages.
- Specialized recovery requires:
  - trusted rich V2 processing anchor,
  - separate trusted `delayed` evidence,
  - separate trusted `alza-commerce-v1` `ready_for_pickup` evidence,
  - same user + same email connection + exact order,
  - <=14-day chain,
  - completed exact 90-day proof with `checked>=1` and `purchaseWrites=0`,
  - no trusted `order_created`,
  - no existing exact Purchase.
- Future matching cases automatically schedule a deduped 90-day proof first.
- No Shipment may be invented when AlzaBox has no tracking.
- `AHUW...` invoice identity remains evidence only; no document is invented from the processing email.
- PR CI #444 passed with 353/353 API tests; main CI #445 and exact Render smoke #339 passed.

### PR #86 — processed-anchor recovery fix

Live verification exposed a safe false negative: after the 90-day scan, the normal pipeline marked the three trusted Alza sources `processed` before the specialized recovery pass, so PR #85's REVIEW/unlinked-only anchor selector skipped the chain. No wrong Purchase was created.

PR #86 / runtime `8b4461ce836c1e1e9e1f0c0813779fdcda3acbbe`:
- recovery eligibility now depends on trusted V2 evidence, not audit processing status,
- DB snake_case Purchase rows are explicitly mapped to the resolver camelCase identity model,
- early existing-Purchase proof scheduling guard fixed,
- final exact DB duplicate check remains.
- PR CI #446, main CI #447 and exact Render smoke #341 passed.

### Final live Alza state

Purchase:
- id `661865f5-23dd-4c26-97dd-1059f533566b`
- merchant `Alza.hu`
- legal name `Alza.hu Kft.`
- domain `alza.hu`
- order `602385238`
- total **3,350 HUF**
- payment status `pending`
- payment method `Kártya átvételkor vagy online`
- shipping method `AlzaBox`
- expected carrier null
- state `ready_for_pickup`
- ordered_at null
- shipped_at null
- delivered_at null
- confidence 0.99.

Integrity:
- exactly **1 Purchase**
- exactly **0 Shipments**
- exactly **3 linked sources**: V2 processing + delayed + ready_for_pickup
- all three sources `processed` / validated
- 0 documents created
- AI 0.

## OTHER COMPLETED DETERMINISTIC COVERAGE

- All In Packaging / GLS historical reconstruction with 90-day proof.
- Gyerekjatekbolt failed payment + cancellation.
- Szidibox / MPL including public-mailbox safety and physical shipped_at semantics.
- Gate.shop / Foxpost ready-for-pickup.
- Scitec / BioTechUSA / Foxpost verified legal-entity COD bridge.
- Ars Una / GLS parcel-sender + COD bridge.
- Allegro / HappyBox24 lifecycle + DPD + seller invoice.
- GymBeam / Express One processing, historical reconstruction and terminal receipt resolution.
- promotional/repurchase hard negatives.
- Express One outbound pickup-noise exclusion.
- Limone merchant parsing.

Three Barion successful-payment emails remain intentionally unlinked because payment-only evidence is insufficient to create a Purchase.

Four McDonald's payment-summary emails remain REVIEW because their reusable 4-digit local/POS order IDs are not safe global Purchase identities. Required future architecture: POS/local-order identity using location/time/provider identity.

## CURRENT LIVE BACKLOG

Verified after Jatekbolt + Alza cleanup:
- REVIEW: **35**
- unlinked: **10**
- total unresolved: **45**
- historical AI runs: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`.

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

1. Continue remaining **35 REVIEW + 10 unlinked** clusters, prioritizing genuine physical-commerce false negatives over obvious noise.
2. Investigate remaining DPD tracking `16380124260338` and other real merchant/carrier clusters before touching payment-only noise.
3. Keep Jatekbolt invoice REVIEW until deterministic attachment/PDF ingestion exists.
4. Keep McDonald's/POS short local IDs REVIEW until a proper local/POS identity model exists.
5. Add verified public-mailbox merchant identity architecture before allowing future Gmail-sender merchants to auto-create Purchases.
6. After recognition backlog improves, align top-level lifecycle labels/counters, then Warranty + Return/refund UI, later Felfedezés.

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

This is a rolling snapshot, not a diary. Never store secrets, credentials or raw customer email bodies here. Detailed newest recovery notes are in `BUYFLOW_WORKLOG_LATEST.md`; older history remains in `BUYFLOW_WORKLOG.md` and Git history.
