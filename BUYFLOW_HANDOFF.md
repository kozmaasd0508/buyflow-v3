# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md` first, then this file, then the newest entries in `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-15 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Last reconciled main commit:** `0505fe96c872f7d6bd20c775838305035ba08b45`  
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

### Gate.shop / Foxpost carrier bridge — completed

Order `20336215` is the current canonical cross-sender bridge example.

PRs #59–#62 establish the full deterministic flow:
- merchant shipment anchor + carrier parcel-sender bridge,
- exact Foxpost lifecycle repair,
- prefer real `CLFOX...` tracking over Packeta `Z...` identity,
- targeted/initial scans run the same lifecycle reconciliation as webhook ingestion,
- explicit pickup-ready evidence is first-class `ready_for_pickup`, never `delivered`,
- monotonic precedence: `delivered > ready_for_pickup > in_transit`,
- weaker later evidence cannot downgrade pickup-ready state,
- controlled shipment RPC accepts `ready_for_pickup`, with SECURITY DEFINER hardening and service-role-only execution.

PR #62 merged to main as `0505fe96c872f7d6bd20c775838305035ba08b45`; main CI run #395 passed.

Live verification after merge:
- Purchase `20336215` current_state = `ready_for_pickup`,
- exactly one Foxpost Shipment,
- tracking `CLFOX178524111362058`,
- Shipment status = `ready_for_pickup`,
- targeted recovery for `Z3493891717`: 2 checked / 2 processed / 0 review / 0 unlinked / AI 0,
- historical `ai_processing_runs` remained 98.

The current session could not directly fetch the public `/health` endpoint to compare `RENDER_GIT_COMMIT`, so do **not** claim literal exact-commit Render smoke is complete yet. The live worker behavior proves the new ready-for-pickup logic is active, but the exact health SHA remains a separate verification item.

### Other completed deterministic coverage

- Promotional/repurchase hard-negative: strong marketing noise is excluded without using Gmail Promotions as a hard gate.
- Allegro / HappyBox24: deterministic order lifecycle, DPD tracking, delivery-today semantics and seller invoice handling.
- Ars Una / GLS: exact GLS sender parsing, parcel sender + COD bridge, tracking `3412614699`; no false delivered state.
- GymBeam / Express One: order-processing enrichment, strict missing-purchase reconstruction, terminal receipt payment resolution and outbound pickup-noise exclusion.
- Limone: deterministic merchant order parsing remains active.

## INTENTIONALLY UNLINKED

Three Barion successful-payment emails remain unlinked because no matching Purchase/order/invoice was found. Payment-only evidence must not create a Purchase.

## OPEN / INCOMPLETE WORK

- PR #58 `Recognize Hungarian Rendelés colon order IDs` is still open and currently not mergeable against the latest main. It covers the generic `Rendelés: #<id>` / `Megrendelés: #<id>` form, with Scitec order `1783-975-87-395` as the regression example.
- One older Foxpost source from 2026-07-15 with subject `Csomagod megérkezett` remains `unlinked`; inspect it independently instead of weakening the Gate.shop rules.
- Warranty UI, Return/refund UI and Felfedezés remain unfinished.

## CURRENT LIVE BACKLOG

Latest verified live counts after the Gate.shop rerun:
- review: **29**
- unlinked: **14**
- total unresolved: **43**
- unresolved Foxpost: **1** old unlinked source
- total historical `ai_processing_runs`: **98**
- latest AI run: `2026-08-14 21:43:08.694227+00`
- the Gate.shop completion created no new AI run.

Re-check live values before future time-sensitive claims.

## NEXT ACTION

If the user gives no different direction:

1. Verify exact Render `/health` commit SHA equals current main `0505fe96c872f7d6bd20c775838305035ba08b45` when an endpoint-capable tool is available.
2. Inspect the single older unlinked Foxpost source from 2026-07-15 and resolve only with unique merchant/tracking evidence.
3. Reconcile/rebase PR #58 against latest main, rerun its CI and verify the Scitec example live before merge.
4. Continue highest-value real review/unlinked clusters, especially Gyerekjatekbolt and McDonald's payment/receipt rows, without weakening Purchase creation safety.
5. Keep the three Barion payment-only emails unlinked unless corroborating merchant evidence appears.
6. Once deterministic recognition is very strong, return to Warranty + Return/refund frontend work.

## WORKFLOW PREFERENCES

- Prefer implementation/live verification over theory.
- Keep user-facing updates short and concrete.
- Do not repeatedly ask for confirmation when direction is clear.
- Browser first for UI; APK only on explicit request.
- Report exact outcomes: counts, CI/deploy, live writes, AI calls and remaining work.

## MAINTENANCE

This is a rolling snapshot, not a diary. After meaningful work update it and prepend concise detail to `BUYFLOW_WORKLOG.md`. Never store secrets, credentials or raw customer email bodies here.
