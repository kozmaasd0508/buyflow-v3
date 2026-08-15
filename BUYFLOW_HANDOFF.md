# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled runtime code commit:** `ebe06d3ee8c6c203bc363ed58eb992670758f667`  
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
7. Carrier/payment evidence may update only an existing uniquely corroborated Purchase or pass an explicitly hardened historical reconstruction lane.
8. Merchant/carrier-specific adapters must not weaken global rules.
9. Browser-first UI. APK only on explicit user request/approval.
10. Supabase DDL via migrations; guarded DML is allowed for verified historical repair.

## MULTI-GMAIL / SCAN UI — LIVE

PR #69 added multi-Gmail settings and per-account 7 / 30 / 90 day deterministic full-inbox scans. PR #70 fixed repeated same-window progress tracking. PR #71 added exact Render deployment proof.

OAuth / second-account fixes completed after the first live connection attempt:
- PR #73: Nylas auth-start resilience and stage diagnostics.
- PR #74: browser session refresh/retry and concrete UI error reporting.
- PR #75 / main `a9a833ed05809b1c66769e6d910c702d04f4321f`: fixed production `email_oauth_states` grants. The server-only table now gives `service_role` only SELECT/INSERT/DELETE; `anon` and `authenticated` have no table privileges. Production migration and service-role OAuth-state smoke passed.
- A second Gmail account is now connected and active in production.

Initial second-account 7-day scan:
- checked 34
- ignored 30
- review 4
- unlinked 0
- Purchase/Shipment/Document writes 0
- AI 0

PR #76 / main `d27ffed0062b73fb2c4845fd1083f70f12235159` fixed the full-scan enqueue bug found during the first 30-day attempt:
- previous code reused the single initial job without resetting its window/state,
- 7 / 30 / 90 are now the only accepted windows,
- completed/retry/pending scans can safely restart with the selected window,
- an actively processing scan cannot be overwritten.

### Second Gmail 30-day blind test

The real deterministic 30-day scan completed successfully:
- pages 3
- checked **149**
- ignored **130**
- REVIEW **14**
- unlinked **5**
- processed **0** before follow-up recovery
- Purchase writes **0**
- Shipment writes **0**
- Document writes **0**
- AI calls **0**

Safety result: zero false automatic Purchases during the blind scan. The scan intentionally left uncertain evidence in REVIEW/unlinked rather than guessing.

## ALL IN PACKAGING / GLS — BLIND-TEST GAP COMPLETED

The second-account blind test exposed a real false negative: an All In Packaging transaction had no `order_created` email in the scanned history, but had a merchant dispatch mail, a merchant invoice for the same order, and a GLS carrier chain.

PR #77 attempted a parallel reconstruction lane, but CI exposed a domain-matching safety issue and the existing stricter historical reconstruction architecture was discovered. PR #77 was **closed unmerged** and superseded.

PR #78 / runtime main `ebe06d3ee8c6c203bc363ed58eb992670758f667` extended the existing strict historical reconstruction path instead:
- new parser `generic-hu-transaction-anchor-v1`,
- strict merchant-owned Hungarian subject forms can identify a dispatch lifecycle anchor and an invoice anchor,
- these anchors never emit `order_created`,
- public/shared/carrier sender domains are rejected,
- merchant label must agree with the sender brand domain,
- existing Invoice Anchor Recovery still requires a completed **90-day exact-order negative search** with `purchaseWrites=0`,
- legacy historical reconstruction remains preferred,
- carrier-only tracking fallback requires exactly one eligible tracking cluster with >=2 trusted deterministic carrier sources, physical progress, matching parcel-sender identity, explicit consistent COD amount+currency, and <=7-day proximity,
- multiple eligible COD tracking clusters block reconstruction,
- a second carrier cluster without COD does not compete,
- fallback does not invent `ordered_at`,
- Purchase and Shipment are materialized only through existing controlled RPCs.

PR #78 CI #425 passed; main CI #426 passed; exact Render Webhook Smoke #320 passed on `ebe06d3ee8c6c203bc363ed58eb992670758f667`.

### Live All In Packaging verification

Order `148810` was reparsed and then passed the required 90-day exact-order proof:
- targeted proof checked 2 messages,
- Purchase writes 0 before reconstruction,
- AI 0.

Final Purchase:
- id `def961ae-202e-4cb7-b757-8e5215f6f51d`
- merchant `All In Packaging`
- domain `allinpackaging.com`
- order `148810`
- total **16,670 HUF**
- payment `cash_on_delivery`
- expected carrier `GLS`
- current state `in_transit`
- confidence 0.90
- `ordered_at=null` intentionally; no order date was invented.
- Purchase `shipped_at=2026-07-31 11:22:50+00` is the merchant-reported “order sent” timestamp by the trusted merchant lifecycle trigger.

Final Shipment:
- id `274cb215-c441-4d98-9a97-2dade4c8310f`
- carrier GLS
- tracking `3219379224`
- status `in_transit`
- `shipped_at=2026-08-04 05:52:38+00` = first verified physical carrier progress
- `last_event_at=2026-08-04 07:03:17+00`
- delivered_at null.

Final integrity checks:
- exactly **1 Purchase** for this merchant/order,
- exactly **1 Shipment** for tracking `3219379224`,
- five correct merchant/carrier source emails are linked and processed,
- separate GLS tracking `3219379250` remains **unlinked** because it has no explicit COD proof; this is intentional safety behavior,
- historical AI run count remains **98** and latest AI run remains `2026-08-14 21:43:08.694227+00`; the entire blind-test recovery used AI 0.

Important timestamp semantics: Purchase `shipped_at` and Shipment `shipped_at` intentionally represent different evidence layers. Purchase records the trusted merchant dispatch timestamp; Shipment records first verified physical carrier progress. Do not normalize them to the same timestamp unless architecture changes deliberately.

## CURRENT EMAIL RECOGNITION

### Gate.shop / Foxpost — completed

Order `20336215` remains the canonical merchant-shipment-anchor cross-sender bridge example. Purchase and the single Foxpost Shipment are `ready_for_pickup`, tracking `CLFOX178524111362058`; AI 0.

### Scitec / BioTechUSA / Foxpost — completed

Order `1783-975-87-395`, 16,780 HUF. `generic-order-confirmation-v1.2`, verified-brand COD fallback and Foxpost parser v1.1 produce exactly one Purchase and one Shipment, tracking `CLFOX178401889449819`, final state `ready_for_pickup`; AI 0.

### Other completed deterministic coverage

- Promotional/repurchase hard-negative without Gmail Promotions as a hard gate.
- Allegro / HappyBox24: deterministic lifecycle, DPD tracking and seller invoice.
- Ars Una / GLS: exact GLS sender parsing, parcel sender + COD bridge, tracking `3412614699`; no false delivered state.
- GymBeam / Express One: processing enrichment, strict missing-purchase reconstruction, terminal receipt payment resolution and outbound pickup-noise exclusion.
- Limone deterministic merchant order parsing active.
- Historical reconstruction remains gated by 90-day exact-order negative proof.

## INTENTIONALLY UNLINKED / NOISE

- Three Barion successful-payment emails remain intentionally unlinked because no matching Purchase/order/invoice was found. Payment-only evidence must not create a Purchase.
- Second-Gmail blind-test REVIEW includes obvious non-Purchase noise such as subscription lifecycle/payment messages, promotions and carrier satisfaction surveys; do not globally loosen rules to clear these.
- GLS tracking `3219379250` remains unlinked by design because the carrier cluster lacks COD proof.

## CURRENT LIVE BACKLOG

Verified after the second Gmail blind test and All In Packaging recovery:
- review: **40**
- unlinked: **15**
- total unresolved: **55**
- historical `ai_processing_runs`: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`

The backlog increased because a second real mailbox was added. Treat this as a richer test dataset, not as a regression by itself.

## FRONTEND STATE / REMAINING UI WORK

Live: login, purchase list/detail, current state + next action, timeline, product edit/remove, order/tracking/document details, targeted missing-purchase recovery, multi-Gmail settings and 7/30/90 full scans.

AI audit/Flow UI stays hidden while deterministic recognition is being improved.

Still incomplete / lagging:
- top-level `main.ts` lifecycle labels/counting need full alignment for `in_transit`, `out_for_delivery`, `ready_for_pickup`, etc.; detail overview already understands these states,
- Warranty UI,
- Return/refund UI,
- Felfedezés.

## NEXT ACTION

If the user gives no different direction:

1. Continue reviewing the **remaining second-Gmail REVIEW/unlinked clusters**, prioritizing genuine purchase false negatives over obvious subscription/promo/noise.
2. For every real miss, derive a reusable rule with strong negative regression tests; never hard-code one order/tracking ID.
3. Preserve the 90-day historical negative-proof architecture for reconstruction cases where no `order_created` mail exists.
4. After recognition backlog improves, align top-level lifecycle labels/counters in `main.ts`.
5. Then proceed to Warranty + Return/refund UI and later Felfedezés.
6. Keep Barion payment-only and other weak evidence unlinked unless corroborating merchant evidence appears.

## TEST QUALITY TARGET

For cross-account validation:
- first meaningful milestone: 20–30 real purchase chains,
- stronger confidence: 50–100 chains across multiple mailboxes/merchants/carriers,
- target >=95% recognition while prioritizing near-zero unsafe automatic linking,
- false automatic Purchase = 0,
- wrong automatic link = 0,
- duplicate Purchase/Shipment = 0,
- REVIEW is preferred over a wrong automatic match.

## WORKFLOW PREFERENCES

- Prefer implementation/live verification over theory.
- Keep user-facing updates short and concrete.
- Do not repeatedly ask for confirmation when direction is clear.
- Browser first for UI; APK only on explicit request.
- Report exact outcomes: PR, commit, CI/deploy, live writes, AI calls and remaining work.

## MAINTENANCE

This is a rolling snapshot, not a diary. After meaningful work update it and prepend concise detail to `BUYFLOW_WORKLOG.md`. Never store secrets, credentials or raw customer email bodies here.
