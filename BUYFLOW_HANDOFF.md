# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled runtime code commit:** `ce759ed001c6f52dcb84cf2b56f431d3da2972ab`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Reconcile this snapshot with current `main`, live Supabase and the latest exact Render deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns chaotic purchase, delivery, invoice, warranty and return emails into one safe Purchase record. It must scale across many users, merchants, carriers and mailbox providers.

- Frontend/mobile web: `apps/mobile`, Render `/app/`; Android packaging later.
- API/backend: TypeScript in `apps/api`.
- Database/auth: Supabase production `acjenqkrvnkdvvgordry`, eu-west-1.
- Email ingestion: Nylas webhook + durable scan/recovery jobs.
- Recognition: deterministic-first; uncertain evidence => REVIEW.
- AI infrastructure exists but **AI is intentionally disabled**. `BUYFLOW_AI_ENABLED` defaults false.
- Production flow: branch -> PR -> CI -> merge -> main CI -> exact Render smoke.

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

## FRONTEND STATE

Live: login, purchase list/detail, current state + next action, timeline, product edit/remove, order/tracking/document details, missing-purchase recovery and Gmail settings.

AI audit/Flow UI stays hidden while deterministic recognition is being improved.

Still unfinished: Warranty UI, Return/refund UI, Felfedezés.

## CURRENT EMAIL RECOGNITION

### Gate.shop / Foxpost — completed

Order `20336215` remains the canonical merchant-shipment-anchor cross-sender bridge example.

PRs #59–#62 established:
- merchant shipment anchor + carrier parcel-sender bridge,
- exact Foxpost lifecycle repair,
- real `CLFOX...` tracking preferred over Packeta `Z...`,
- targeted scans run lifecycle reconciliation,
- `ready_for_pickup` is first-class and monotonic: `delivered > ready_for_pickup > in_transit`.

PR #62 runtime commit: `0505fe96c872f7d6bd20c775838305035ba08b45`; main CI #395 passed.

Live Gate.shop verification:
- Purchase `20336215` = `ready_for_pickup`,
- exactly one Foxpost Shipment,
- tracking `CLFOX178524111362058`,
- targeted recovery: 2/2 processed, 0 review, 0 unlinked, AI 0.

### Scitec / BioTechUSA / Foxpost — completed

Order `1783-975-87-395`, total `16,780 HUF`.

PR #65 / main `053d4e1190b6bc8fd35f1c00932508c7b473dc8c`:
- generic parser `generic-order-confirmation-v1.2`,
- accepts safe Hungarian `Rendelés: #...` / `Megrendelés: #...` identity,
- accepts real `Köszönjük megrendelésedet` confirmation wording,
- carrier/shared-platform/public-mailbox exclusions and >=2 corroborators remain mandatory,
- stale PR #58 was closed as superseded.

Live order recovery after #65:
- 1 checked / 1 processed / 0 review / 0 unlinked,
- exactly one Purchase created,
- merchant Scitec, order `1783-975-87-395`, total `16,780 HUF`, confidence 0.95,
- AI 0.

PR #66 / main `3d73da6a1e42410955d28bca1e54024538c0b092`:
- added a deliberately narrow verified-brand COD carrier fallback,
- initial explicit identity: `scitec.hu` + normalized `BioTechUSA Kft.` + Foxpost,
- requires >=2 carrier sources on one tracking, exact COD+currency, <=7-day window, Purchase confidence >=0.95 and exactly one candidate,
- generic carrier-only evidence still cannot guess a Purchase,
- tracking-only pre-advice may corroborate but does not count as physical shipment progress.

Live #66 verification:
- Foxpost tracking `CLFOX178401889449819`,
- Purchase and Shipment became `ready_for_pickup`,
- no delivered state,
- AI 0.

PR #67 / main runtime commit `ce759ed001c6f52dcb84cf2b56f431d3da2972ab`:
- Foxpost parser `foxpost-lifecycle-v1.1`,
- accepts trusted Foxpost `Csomagod azonosítószáma: CLFOX...` warehouse-arrival format,
- exact/child `foxpost.hu`, labelled `CLFOX`, explicit parcel sender and lifecycle wording remain required,
- main CI #405 passed.

Final live Scitec/Foxpost chain:
- `Előértesítés` -> processed + linked,
- `Csomagod már a raktárunkban van` -> parser `foxpost-lifecycle-v1.1`, `in_transit`, BioTechUSA Kft., COD 16,780 HUF -> processed + linked,
- `Csomagod megérkezett` -> `ready_for_pickup` -> processed + linked,
- final targeted rerun: **3 checked / 3 processed / 0 review / 0 unlinked / AI 0**,
- exactly one Purchase and one Foxpost Shipment,
- Purchase + Shipment final state `ready_for_pickup`,
- Shipment `shipped_at=2026-07-14 17:33:28+00`, first explicit physical warehouse arrival,
- `last_event_at=2026-07-15 09:55:07+00`, delivered_at remains null.

### Other completed deterministic coverage

- Promotional/repurchase hard-negative: strong marketing noise excluded without Gmail Promotions as a hard gate.
- Allegro / HappyBox24: deterministic lifecycle, DPD tracking and seller invoice.
- Ars Una / GLS: exact GLS sender parsing, parcel sender + COD bridge, tracking `3412614699`; no false delivered state.
- GymBeam / Express One: processing enrichment, strict missing-purchase reconstruction, terminal receipt payment resolution and outbound pickup-noise exclusion.
- Limone: deterministic merchant order parsing active.

## INTENTIONALLY UNLINKED

Three Barion successful-payment emails remain unlinked because no matching Purchase/order/invoice was found. Payment-only evidence must not create a Purchase.

## OPEN / INCOMPLETE WORK

- Literal public Render `/health` `RENDER_GIT_COMMIT` verification is still not directly fetchable from the current tool environment. Live worker behavior proves #65–#67 behavior is active, but do not claim exact SHA smoke until `/health` is read directly.
- Warranty UI, Return/refund UI and Felfedezés remain unfinished.

## CURRENT LIVE BACKLOG

Latest verified live counts after the complete Scitec/Foxpost rerun:
- review: **28**
- unlinked: **13**
- total unresolved: **41**
- historical `ai_processing_runs`: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`
- #65–#67 live verification created no AI run.

Re-check live values before future time-sensitive claims.

## NEXT ACTION

If the user gives no different direction:

1. Continue the highest-value real review/unlinked clusters, starting with Gyerekjatekbolt payment rows and McDonald's receipt/payment rows, without weakening Purchase creation safety.
2. Keep the three Barion payment-only emails unlinked unless corroborating merchant evidence appears.
3. Verify public Render `/health` exact commit SHA when the endpoint becomes directly readable.
4. Once deterministic recognition is very strong, return to Warranty + Return/refund frontend work, then Felfedezés.

## WORKFLOW PREFERENCES

- Prefer implementation/live verification over theory.
- Keep user-facing updates short and concrete.
- Do not repeatedly ask for confirmation when direction is clear.
- Browser first for UI; APK only on explicit request.
- Report exact outcomes: counts, CI/deploy, live writes, AI calls and remaining work.

## MAINTENANCE

This is a rolling snapshot, not a diary. After meaningful work update it and prepend concise detail to `BUYFLOW_WORKLOG.md`. Never store secrets, credentials or raw customer email bodies here.
