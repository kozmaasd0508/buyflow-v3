# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled runtime code commit:** `5fdf20f69dc4f3518d36400223f7a522f124de79`  
**Current main after deployment-diagnostic improvement:** `44fa37bd89b268049230dcb45e86920ac93d3cc0`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Reconcile this snapshot with current `main`, live Supabase and the latest exact Render deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns chaotic purchase, delivery, invoice, warranty and return emails into one safe Purchase record. It must scale across many users, merchants, carriers and mailbox providers.

- Frontend/mobile web: `apps/mobile`, Render `/app/`; Android packaging only when explicitly requested.
- API/backend: TypeScript in `apps/api`.
- Database/auth: Supabase production `acjenqkrvnkdvvgordry`, eu-west-1.
- Email ingestion: Nylas webhook + durable full-inbox/targeted scan jobs.
- Recognition: deterministic-first; uncertain evidence => REVIEW.
- AI infrastructure exists but **AI is intentionally disabled**. `BUYFLOW_AI_ENABLED` defaults false.
- Production flow: branch -> PR -> CI -> merge -> main CI -> exact Render runtime proof.

## NON-NEGOTIABLE SAFETY

1. Purchase creation != lifecycle. Shipment/delivery/invoice/payment-only mail cannot create a Purchase in normal flow.
2. Multiple plausible candidates => REVIEW, never unsafe auto-link.
3. Strong identity first: order ID, tracking identity, then narrow corroborated fallbacks.
4. “Delivery today” is not delivered without explicit completion evidence.
5. Gmail categories are advisory only; never a gate.
6. Shared platform/public mailbox domains cannot alone establish merchant identity.
7. Carrier/payment evidence may update only an existing uniquely corroborated Purchase.
8. Merchant/carrier-specific adapters must not weaken global rules.
9. Browser-first UI. APK only on explicit user request/approval.
10. Supabase DDL via migrations; guarded DML is allowed for verified historical repair.

## FRONTEND / MULTI-GMAIL STATE

### PR #69 — multi Gmail + full deterministic scan UI

Runtime main commit: `afa01c0d21179dc6472b7e32d427c789282d34ea`.

The Gmail settings UI now:
- lists **all active Gmail/Nylas connections** for the BuyFlow user instead of only the first one,
- shows `+ Másik Gmail hozzáadása` even when one Gmail is already connected,
- exposes per-account **7 / 30 / 90 day full-inbox scans**,
- recommends **30 days** for the planned blind second-account test,
- does not require webshop/order-number search terms for the full scan,
- displays checked / processed / REVIEW / unlinked / Purchase writes / Shipment writes / Document writes / AI calls,
- continues to use the existing deterministic pipeline; recognition/parser/resolver rules were not weakened.

Backend `/api/email-connections/:id/initial-scan` now accepts only 7, 30 or 90 day windows. A newly connected Gmail still receives the existing automatic 7-day initial scan; the user can then start the 30-day full scan from the UI.

Important semantics: this is a **real deterministic write-mode inbox scan/import**, not the old AI observe-only benchmark. Safe recognized records may be written; uncertain evidence stays REVIEW. AI remains disabled.

PR #69 PR CI #408 passed; main CI #409 passed.

### PR #70 — repeated scan progress fix

Runtime main commit: `5fdf20f69dc4f3518d36400223f7a522f124de79`.

Fixed a UI race where repeating the same 7/30/90-day window could briefly see the previous completed scan before the new job was enqueued and stop polling too early. The server-side scan was safe, but the UI could fail to follow progress. Now the scan is enqueued first, the clicked button immediately shows `Indítás…`, then polling follows the new/latest job.

PR #70 CI #410 passed; main CI #411 passed.

### Exact production verification

PR #71 upgraded `.github/workflows/render-health-diagnostic.yml` so it reads `/health`, resolves the latest runtime-changing repository commit and proves that the deployed Render commit contains that runtime commit in its ancestry.

Diagnostic run #4 on 2026-08-15 reported:
- expected runtime commit: `5fdf20f69dc4f3518d36400223f7a522f124de79`
- deployed Render commit: `5fdf20f69dc4f3518d36400223f7a522f124de79`
- `runtime_deployment_verified=true`
- service version `0.4.0`
- automation mode `write`

Therefore the multi-Gmail + 7/30/90 full scan UI and repeated-scan fix are **exactly verified live on Render**.

### Other frontend state

Live: login, purchase list/detail, current state + next action, timeline, product edit/remove, order/tracking/document details, targeted missing-purchase recovery and multi-Gmail settings/full scans.

AI audit/Flow UI stays hidden while deterministic recognition is being improved.

Still incomplete / lagging:
- top-level `main.ts` lifecycle labels/counting still need full alignment for `in_transit`, `out_for_delivery`, `ready_for_pickup`, etc.; detail overview already understands these states,
- Warranty UI,
- Return/refund UI,
- Felfedezés.

## CURRENT EMAIL RECOGNITION

### Gate.shop / Foxpost — completed

Order `20336215` remains the canonical merchant-shipment-anchor cross-sender bridge example.

PRs #59–#62 established:
- merchant shipment anchor + carrier parcel-sender bridge,
- exact Foxpost lifecycle repair,
- real `CLFOX...` tracking preferred over Packeta `Z...`,
- targeted scans run lifecycle reconciliation,
- `ready_for_pickup` is first-class and monotonic: `delivered > ready_for_pickup > in_transit`.

Live Gate.shop verification:
- Purchase `20336215` = `ready_for_pickup`,
- exactly one Foxpost Shipment,
- tracking `CLFOX178524111362058`,
- targeted recovery: 2/2 processed, 0 review, 0 unlinked, AI 0.

### Scitec / BioTechUSA / Foxpost — completed

Order `1783-975-87-395`, total `16,780 HUF`.

PR #65:
- `generic-order-confirmation-v1.2`, safe Hungarian `Rendelés: #...` / `Megrendelés: #...`,
- recognizes `Köszönjük megrendelésedet`,
- trusted merchant + corroboration/public-mailbox safety unchanged.

PR #66:
- narrow verified-brand COD fallback for `scitec.hu` + BioTechUSA Kft. + Foxpost,
- >=2 carrier sources, exact COD+currency, <=7 days, Purchase confidence >=0.95, exactly one candidate,
- generic carrier-only guessing remains blocked.

PR #67:
- Foxpost parser `foxpost-lifecycle-v1.1`, including trusted `Csomagod azonosítószáma: CLFOX...` warehouse-arrival format.

Final live chain:
- tracking `CLFOX178401889449819`,
- 3 checked / 3 processed / 0 review / 0 unlinked / AI 0,
- exactly one Purchase and one Foxpost Shipment,
- final state `ready_for_pickup`,
- `shipped_at=2026-07-14 17:33:28+00`,
- `last_event_at=2026-07-15 09:55:07+00`,
- delivered_at null.

### Other completed deterministic coverage

- Promotional/repurchase hard-negative without Gmail Promotions as a hard gate.
- Allegro / HappyBox24: deterministic lifecycle, DPD tracking and seller invoice.
- Ars Una / GLS: exact GLS sender parsing, parcel sender + COD bridge, tracking `3412614699`; no false delivered state.
- GymBeam / Express One: processing enrichment, strict missing-purchase reconstruction, terminal receipt payment resolution and outbound pickup-noise exclusion.
- Limone deterministic merchant order parsing active.

## INTENTIONALLY UNLINKED

Three Barion successful-payment emails remain intentionally unlinked because no matching Purchase/order/invoice was found. Payment-only evidence must not create a Purchase.

## CURRENT LIVE BACKLOG

Last verified before any new second-Gmail test:
- review: **28**
- unlinked: **13**
- total unresolved: **41**
- historical `ai_processing_runs`: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`

Re-check these values after any new full inbox scan; a second account will naturally change dataset totals.

## NEXT ACTION

If the user gives no different direction:

1. **Use the live browser UI to connect a second Gmail account.**
2. Let its automatic 7-day initial scan finish, then run the **30-day full inbox scan** from Email és Gmail.
3. Record the result counts and manually compare against real purchases in that second mailbox: found, missed, false Purchase, incorrect link, REVIEW, duplicates.
4. Fix only generalizable recognition gaps; never hard-code individual order/tracking IDs.
5. After the blind test, align the remaining top-level lifecycle labels/counters in `main.ts`.
6. Then continue high-value unresolved clusters (Gyerekjatekbolt, McDonald's) and later Warranty + Return/refund + Felfedezés.
7. Keep Barion payment-only rows unlinked unless corroborating merchant evidence appears.

## TEST QUALITY TARGET

For the 30-day cross-account validation:
- first meaningful milestone: 20–30 real purchase chains,
- stronger confidence: 50–100 chains across multiple mailboxes/merchants/carriers,
- target >=95% recognition while prioritizing near-zero unsafe automatic linking,
- REVIEW is preferred over a wrong automatic match.

## WORKFLOW PREFERENCES

- Prefer implementation/live verification over theory.
- Keep user-facing updates short and concrete.
- Do not repeatedly ask for confirmation when direction is clear.
- Browser first for UI; APK only on explicit request.
- Report exact outcomes: PR, commit, CI/deploy, live writes, AI calls and remaining work.

## MAINTENANCE

This is a rolling snapshot, not a diary. After meaningful work update it and prepend concise detail to `BUYFLOW_WORKLOG.md`. Never store secrets, credentials or raw customer email bodies here.
