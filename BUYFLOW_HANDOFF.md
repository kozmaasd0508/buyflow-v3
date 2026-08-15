# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled main commit:** `20ad2db45df68a1dd9d7e97f64fcc1401bd3b850`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Reconcile this file with current `main`, live Supabase and the latest exact Render deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT GOAL

BuyFlow is an all-in-one purchase, delivery, invoice, warranty and return dashboard. It must scale to large, chaotic mailboxes and safely turn commerce email chains into one continuously updated Purchase.

## CURRENT ARCHITECTURE

- Frontend/mobile web: `apps/mobile`, served at Render `/app/`; later packaged as Android.
- API/backend: TypeScript in `apps/api`.
- Database/auth: Supabase production `acjenqkrvnkdvvgordry`, eu-west-1.
- Email ingestion: Nylas webhook + durable email scan/recovery jobs.
- Recognition: deterministic parsers first; uncertain commerce evidence goes to REVIEW.
- AI infrastructure exists but **AI is intentionally disabled**. `BUYFLOW_AI_ENABLED` defaults false.
- Deployment: branch -> PR -> CI -> merge -> main CI -> exact Render smoke.

## NON-NEGOTIABLE SAFETY RULES

1. Purchase creation and lifecycle are separate. Shipment/delivery/invoice/payment-only mail cannot create Purchase in normal flow.
2. Multiple plausible matches => REVIEW, never unsafe auto-link.
3. Strong identity first: order ID, tracking identity, then narrow corroborated fallbacks.
4. Carrier “delivery today” wording is not final delivered without completion evidence.
5. Merchant/carrier-specific fixes must not weaken global rules.
6. Gmail categories are advisory only; never a required gate.
7. Shared platform/public mailbox domains cannot alone establish merchant identity.
8. Payment receipts can update only an existing uniquely corroborated Purchase; never create one.
9. Browser-first UI. APK only on explicit user request/approval.
10. Supabase DDL via migrations and re-check advisors after DDL.

## FRONTEND STATE

Current mobile/web modules include login, purchase list/detail, current state + next action, timeline, product edit/remove, order/tracking/document details, missing-purchase recovery and Gmail settings.

AI audit/Flow UI is hidden while deterministic recognition is being improved.

Still missing/unfinished:
- Warranty UI
- Return/refund UI
- Felfedezés
- Flow remains hidden while AI is off

## CURRENT EMAIL RECOGNITION

### Gmail category independence

A real Limone confirmation `98691-106627` landed in Gmail Personal. The global Purchases-category gate was removed. BuyFlow now evaluates signed incoming mail regardless of Gmail category.

### Generic order parser

Generic deterministic order recognition is live for unknown merchants when several independent order signals agree. Tests cover multiple platform-like and multilingual layouts. Newsletter, abandoned-cart, carrier-only, invoice-only and payment-only mail must not become new Purchases.

### Known live examples

- Limone `98691-106627`: recovered from non-Purchases Gmail category, AI 0.
- Allegro / HappyBox24 UUID `3fe09c80-8d79-11f1-b193-cf13a29b46f5`: parser `allegro-order-v1.4`, total 5,675 HUF, shipping 1,990 HUF, COD/DPD, product prices 1,830 and 1,855 HUF.
- Alza `602385238`: lifecycle chain remains conservative and did not create a false Purchase.

## EXPRESS ONE OUTBOUND PICKUP NOISE — COMPLETE

PR #47 / main `2bac53d5550236023824b08cbefc9fd8a708652c` added a narrow exclusion for Express One WEBCAS **outbound courier pickup bookings** (`árufelvétel` / `request_curier`). These are not consumer purchases or inbound parcel lifecycle mail.

Historical cleanup:
- 43 unresolved pickup-service rows -> 0
- 5 false `order_created`
- 38 false `shipment`
- 0 Purchase links before cleanup
- rows kept for audit as `ignored/other`, with previous machine result preserved
- real Express One parcel mail remains eligible

## NEW: GYMBEAM ORDER-PROCESSING PARSER

PR #49 introduced a strict parser for trusted GymBeam `rendelésed feldolgozás alatt van` summaries. PR #50 fixed the real Nylas flattened-table shape.

Current live parser: **`gymbeam-order-processing-v1.1`**.

It requires trusted GymBeam sender, explicit processing language, order number, order summary, payment + shipping method, product rows and money reconciliation. It emits:
- event `order_updated`
- lifecycle `order_processing`
- **never `order_created`**

Live verified AI-free:
- order `3010206178`: 9,450 HUF, COD, Express One, 4 products
- order `3010228912`: 13,240 HUF, COD, Express One, 5 products

The existing Purchases were enriched from these validated deterministic sources:
- `3010206178`: subtotal 7,960; shipping 1,190; total 9,450 HUF; 4 products
- `3010228912`: subtotal 11,750; shipping 1,190; total 13,240 HUF; 5 products

## NEW: STRICT HISTORICAL RECONSTRUCTION `3010085026`

A real missing GymBeam order was found while resolving the remaining Express One messages.

Exact evidence:
- GymBeam processing summary
- GymBeam merchant shipment email
- GymBeam invoice
- three Express One lifecycle emails with one exact tracking identity
- exact 90-day search found no `order_created` email

Reconstructed exactly once:
- order `3010085026`
- total 17,270 HUF
- subtotal/products 15,780 HUF
- shipping 1,190 HUF
- COD fee 300 HUF
- payment `Utánvéttel`
- carrier Express One
- tracking `605855680768000013605231`
- invoice `4008742640`
- 11 product rows
- Purchase confidence 0.90

Verification: 1 Purchase, 1 shipment, 1 invoice, 11 products; no duplicates.

## NEW: EXPRESS ONE TERMINAL RECEIPT RESOLVER

PR #51 / current main **`20ad2db45df68a1dd9d7e97f64fcc1401bd3b850`** is live and exact Render smoke passed.

Parser/resolver: `expressone-terminal-receipt-v1`.

Purpose: card-terminal receipts sent by Express One when an **existing COD parcel** is paid by card at delivery.

Automatic linking requires ALL:
- exact sender `slip@expressone.hu`
- exact `Fizetési bizonylat` subject
- successful card purchase transaction
- exact amount + currency
- existing Purchase marked COD / Utánvét
- Purchase expected carrier Express One
- Shipment carrier Express One
- shipment event within 2 hours of receipt
- exactly one candidate

Zero or multiple candidates => REVIEW. Receipt is explicitly ineligible for Purchase creation.

Live historical links:
- 9,450 HUF MasterCard receipt -> GymBeam `3010206178`
- 13,240 HUF MasterCard receipt -> GymBeam `3010228912`

Both Purchases are now `payment_status=paid` with exact receipt timestamps.

Live webhook re-test of the 9,450 HUF receipt after deployment:
- source `payment_completed`
- `processed`
- `validated`
- parser `expressone-terminal-receipt-v1`
- exactly 1 Purchase link
- AI 0

## CURRENT LIVE BACKLOG SNAPSHOT

After the above cleanup/resolution:
- `review`: **34**
- `unlinked`: **26**
- Express One review/unlinked remaining: **0**

Historical AI counter:
- total `ai_processing_runs`: **98**
- latest historical run: `2026-08-14 21:43:08.694227+00`
- no new AI run during the current deterministic work

Re-check live values before future time-sensitive claims.

## OTHER IMPORTANT COMPLETED WORK

- Unlinked Resolver V2
- Tracking Bridge V2.1–V2.6 + hard tracking identity
- Review Resolver V3
- Carrier delivery semantic hardening
- Corroborated Document Resolver
- Product edit/remove with source-evidence preservation
- SECURITY DEFINER hardening
- password reset token scrub + stronger password policy
- deterministic email visibility increased from 20k to 80k characters

Known tracking identities:
- GymBeam `3010085026` -> `605855680768000013605231`
- GymBeam `3010206178` -> `605855685055000013605231`
- GymBeam `3010228912` -> `605855685836000013605231`
- JatekBolt `12247833` -> `16380124260518`

## NEXT ACTION

If the user gives no different direction:

1. Continue through remaining `review/unlinked` rows by highest value/risk.
2. First clean the old false `order_created` marketing rows already verified as promotions (Goddess/Shopify promo, Galaxy promo, Sport8 coupon) with narrow/generalizable deterministic rules.
3. Leave BF-TEST Gmail synthetic examples in review; public-mailbox protection is intentional.
4. Then inspect remaining shipment/invoice/payment clusters and improve parsers without weakening global creation gates.
5. When AI-free recognition is very strong, return to Warranty + Return/Refund frontend work.

## WORKFLOW PREFERENCES

- User prefers implementation/live verification over theory.
- Keep user-facing updates short and simple.
- Do not ask for repeated confirmation when direction is clear.
- Browser first for UI, APK only on explicit request.
- Report concrete outcomes: what changed, counts, CI/deploy status, AI calls and what remains.

## MAINTENANCE RULE

This is a rolling snapshot, not a diary. After meaningful work update this file and append history to `BUYFLOW_WORKLOG.md`. Never store secrets, tokens, passwords or raw customer email bodies here.
