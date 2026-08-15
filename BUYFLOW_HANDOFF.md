# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled main commit:** `35dd96f1678c4bba74ecc973288cfb0f1df1dc43`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

If a new chat starts, do not ask the user to retell BuyFlow history. Reconcile this snapshot with current `main`, live Supabase and the latest exact Render deployment.

Minimal resume phrase:

> **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns chaotic purchase, delivery, invoice, warranty and return emails into one safe Purchase record. It must scale across many users, merchants, carriers and mailbox providers.

- Frontend/mobile web: `apps/mobile`, Render `/app/`; later Android packaging.
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

Live: login, purchase list/detail, current state + next action, timeline, product edit/remove, order/tracking/document details, missing-purchase recovery, Gmail settings.

AI audit/Flow UI stays hidden while deterministic recognition is being improved.

Still unfinished: Warranty UI, Return/refund UI, Felfedezés.

## CURRENT EMAIL RECOGNITION

### Gmail category independence

Real Limone order `98691-106627` landed outside Gmail Purchases. The global category gate is removed; BuyFlow evaluates signed incoming mail itself.

### Generic order recognition

Unknown merchants can be recognized deterministically only when several independent order signals agree. Newsletter, abandoned-cart, carrier-only, invoice-only and payment-only mail must not become new Purchases.

### Promotional / repurchase hard-negative

PR #53 / main `6ba285ac7a8c975eb7807b07b2253fc181c8a210` added a conservative marketing exclusion.

- Gmail Promotions itself is NOT a gate.
- Strong promo/repurchase evidence with no transactional anchor can be ignored.
- Explicit order/tracking/invoice identity or real order-confirmation language overrides marketing exclusion.
- Historical verified noise cleaned: 4 rows (Goddess/Galaxy/Sport8 examples), old machine results preserved.
- BF synthetic Gmail test messages intentionally remain review.

### Allegro / HappyBox24 lifecycle + invoice

Order UUID `3fe09c80-8d79-11f1-b193-cf13a29b46f5`, merchant HappyBox24, 5,675 HUF, COD, DPD.

PR #54 / main `012b80e0273ce18bcc252e0a076ce1a566f4cccd` added `allegro-lifecycle-v1`:
- exact Allegro purchase-history UUID + tracking bridge,
- DPD relay tracking,
- delivery-today => out_for_delivery, not delivered,
- explicit successful delivery => delivered,
- relay messages never invent order IDs.

Live chain:
- tracking `13169408547018`
- exactly 1 Purchase + 1 DPD shipment
- all 5 lifecycle emails processed/linked.

PR #55 / main `1f8c19d4dcf1ca80f09cc10a99946d4a836fd8ea` added `allegro-sales-document-v1` so document identity wins over incidental “package arrived” wording.

Verified seller invoice:
- invoice `I/00005/08/26`
- seller internal order `46181083`
- total 5,675 HUF
- shipping 1,990 HUF
- product prices 1,830 + 1,855 HUF
- exactly 1 invoice document linked to HappyBox24 Purchase.

### Ars Una / GLS carrier bridge

Order `192132`, Ars Una Studio Kft.

Verified PDF invoice (rendered visually before write):
- invoice `5133964`
- explicit order reference `192132`
- product 6,276 HUF
- shipping 1,990 HUF
- total 8,266 HUF
- payment Utánvét
- exactly 1 invoice document linked to Purchase.

GLS carrier emails state COD 8,265 HUF: a verified 1 HUF difference from the official invoice. The system does **not** call this exact equality.

PR #56 / current runtime main `35dd96f1678c4bba74ecc973288cfb0f1df1dc43` added:
- parser `gls-lifecycle-v1`
- bridge `carrier-sender-cod-bridge-v1`
- exact sender `noreply@gls-hungary.com`
- pre-advice => `shipment_created`
- delivery today => `out_for_delivery`, never delivered
- dynamic GLS RTT URL => tracking extraction + conservative `in_transit`
- parcel sender + COD extraction
- automatic bridge only when exactly one recent existing COD Purchase matches exact normalized merchant identity, carrier compatibility and amount within 1 currency unit
- exactly one existing merchant shipment source without tracking is required before the bridge adds tracking to merchant evidence
- zero/multiple candidates => review.

Live Ars Una verification:
- Purchase total 8,266 HUF
- tracking `3412614699`
- carrier GLS
- exactly 1 shipment
- pre-advice and merchant pre-handoff remain `shipment_created`
- first physical progress = delivery-today email
- current state `in_transit`
- no delivered state because no completion email was found
- dynamic tracking email processed from GLS RTT URL
- unresolved GLS rows = 0
- AI calls = 0.

### Express One / GymBeam completed work

- Express One outbound pickup noise: 43 false unresolved rows cleaned to 0; real parcel mail preserved.
- `gymbeam-order-processing-v1.1` parses trusted processing summaries as lifecycle only, never `order_created`.
- Missing GymBeam `3010085026` strictly reconstructed from multi-source evidence: 17,270 HUF, 11 products, tracking `605855680768000013605231`, invoice `4008742640`.
- Express One terminal receipt resolver links successful delivery-time card receipts only to one existing COD Purchase.
- GymBeam `3010206178` and `3010228912` receipts/payment state corrected without AI.

## INTENTIONALLY UNLINKED: BARION PAYMENT-ONLY

Three Barion successful-payment emails remain unlinked because no matching Purchase/order/invoice was found for them in the mailbox or database. Payment-only mail must not create a Purchase. This is correct safe behavior, not a bug to force-resolve.

## CURRENT LIVE BACKLOG

Latest verified counts after Ars Una / GLS recovery:
- review: **28**
- unlinked: **18**
- total unresolved: **46**
- unresolved GLS: **0**
- total historical `ai_processing_runs`: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`
- current deterministic work created no new AI runs.

Re-check live values before future time-sensitive claims.

## NEXT ACTION

If the user gives no different direction:

1. Inspect Foxpost unresolved cluster (3 delivery + 2 shipment) by exact tracking/merchant evidence.
2. Then Gyerekjatekbolt payment review rows and McDonald's receipt/payment rows.
3. Keep the 3 Barion payment-only emails unlinked unless corroborating merchant evidence appears.
4. Leave BF synthetic Gmail tests in review intentionally.
5. Continue highest-value real review/unlinked clusters without weakening Purchase creation safety.
6. Once AI-free recognition is very strong, return to Warranty + Return/refund frontend work.

## WORKFLOW PREFERENCES

- User prefers implementation/live verification over theory.
- Keep user-facing updates short and concrete.
- Do not repeatedly ask for confirmation when direction is clear.
- Browser first for UI; APK only on explicit request.
- Report exact outcomes: counts, CI/deploy, live writes, AI calls, remaining work.

## MAINTENANCE

This is a rolling snapshot, not a diary. After meaningful work update it and prepend concise detail to `BUYFLOW_WORKLOG.md`. Never store secrets, credentials or raw customer email bodies here.
