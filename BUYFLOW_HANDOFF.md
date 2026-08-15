# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older detail remains in Git history and `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-16 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current runtime main:** `994be825f3f91b329ced10080bdb8dae43c9492e`  
**Last reconciled runtime code commit:** `994be825f3f91b329ced10080bdb8dae43c9492e`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when it is recoverable from GitHub/Supabase. Reconcile this snapshot with current `main`, live data and latest exact Render smoke.

Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns purchase, payment, shipment, invoice, warranty and return emails into one safe Purchase record.

- frontend/mobile web: `apps/mobile`, Render `/app/`; APK only when explicitly requested
- backend: TypeScript in `apps/api`
- Supabase production: `acjenqkrvnkdvvgordry`, eu-west-1
- email: Nylas webhook + durable full-inbox/targeted scans
- recognition: deterministic-first; ambiguity => REVIEW
- AI intentionally disabled; historical `ai_processing_runs` remains 98
- release: branch -> PR -> PR CI -> merge -> main CI -> exact Render smoke

## NON-NEGOTIABLE SAFETY

1. Purchase creation != lifecycle.
2. Multiple plausible candidates => REVIEW; never guess.
3. Exact order/tracking/verified identity outranks timing or amount.
4. `out_for_delivery` / “today” != delivered.
5. Public/shared mailbox cannot establish merchant identity alone.
6. Packing, pre-advice and `shipment_created` cannot prove physical shipment.
7. Phase-less generic shipment evidence also cannot prove physical shipment.
8. Carrier pickup from the sender is `shipped`, never recipient delivery.
9. Documents preserve provenance; private PDFs remain private and use short signed URLs.
10. Supabase DDL via migrations; no unsafe historical writes.

## NEW — USER-SUPPLIED 100-EMAIL BENCHMARK / PR #97

The user supplied `buyflow_demo_emails_100(1).xlsx`. It was converted into an isolated permanent regression benchmark without injecting fake Gmail/Nylas or production purchases.

Corpus:
- 100 emails
- 70 purchase/lifecycle events
- 30 noise/hard negatives
- 10 complete purchase journeys
- 20 expected labels
- merchants include Alza, eMAG, Notino, Amazon.de, MediaMarkt, ABOUT YOU, IKEA, iStyle, Decathlon, SHEIN
- carriers include GLS, Express One, DPD, DHL, Packeta, MPL, Foxpost and store pickup
- lifecycle types include order/payment/processing/packing/pre-advice/shipped/transit/out-for-delivery/delivery-failed/delivered/cancel/return/refund/warranty/invoice

Reserved `*.example` carrier senders are normalized **only inside the test** to already trusted carrier identities. Production trust was not weakened.

### First blind run — CI #477 failed usefully

Safety defects found:
1. Six legitimate SHIPPED emails containing `a futár átvette a feladótól` were incorrectly classified as DELIVERED because generic delivery detection accepted bare `átvette`.
2. Three generic SHIPMENT_CREATED/pre-advice emails were recognized without a phase; the Shipment resolver treated `shipment + phase=null` as physical progress.

First-run good safety:
- noise false parser matches: 0/30
- wrong order/tracking identity: 0
- no lifecycle email became a new Purchase

### Fix / final result

Runtime merged as `994be825f3f91b329ced10080bdb8dae43c9492e`.
- PR #97 final CI #481: 376/376 API tests, API build, mobile typecheck/build green
- main CI #482 green
- exact Render smoke #376 green for exact runtime commit

Fixes:
- delivery now requires explicit completion/recipient evidence; sender-side carrier pickup is `shipped`
- generic trusted-carrier messages can emit explicit `shipment_created`, `shipped`, `out_for_delivery`, `delivered`
- phase-less shipment evidence no longer counts as physical progress
- previous generic DPD “delivery today” semantics gap now emits `out_for_delivery`, never delivered

Final 100-email safety report:
- 30/30 noise safely unrecognized
- 0 wrong order/tracking identities
- 0 unsafe lifecycle promotions
- 0 recognized pre-advice without explicit `shipment_created`
- SHIPMENT_CREATED exact: 3/4; MPL demo wording remains outside strict real MPL parser
- SHIPPED exact: 6/6
- generic purchase-related recognition currently: 9/70

**Important:** 9/70 is not overall BuyFlow production recall. This workbook intentionally uses new generic patterns that existing merchant-specific adapters do not cover. The benchmark is now a gap detector and permanent safety regression.

## NEXT BENCHMARK-DERIVED WORK

Add coverage incrementally, without weakening safety. Highest-value gaps from the 100-email corpus:
1. generic strong order confirmation phrase: `Rögzítettük a(z) <id> azonosítójú megrendelést`
2. explicit payment success / failed / action-required tied to stable order identity
3. generic processing / packing / cancelled lifecycle evidence
4. carrier transit/delivered/out-for-delivery text where tracking exists but is not presented through current label patterns
5. ready-for-pickup/store-pickup semantics
6. return/refund/warranty lifecycle
7. invoice-email anchor; PDF attachment lane remains separate
8. strict MPL generic-vs-official sender/syntax handling

Do not add one broad regex to make benchmark numbers look better. Every new auto path must preserve false Purchase=0, wrong auto-link=0, ambiguity=>REVIEW.

## EXISTING LIVE CAPABILITIES

- multi-Gmail OAuth and per-account 7/30/90-day scans
- deterministic order creation and lifecycle for proven merchants/carriers
- purchase/shipment identity resolution and REVIEW safety
- historical recovery lanes for proven cases
- PDF attachment download from Nylas
- private Supabase Storage
- PDF text-layer extraction and invoice/order identity
- exact Purchase document linking
- 60-second signed PDF opening in Purchase detail
- Jatekbolt `S26_044783.pdf` proven live
- scanned/raster PDF OCR still not implemented

## CURRENT LIVE BACKLOG

Last verified source-email backlog before this benchmark-only work:
- REVIEW: 34
- unlinked: 10
- unresolved: 44
- historical AI runs: 98

PR #97 is parser/resolver safety + benchmark work; it did not itself scan the production inbox or create Purchase/Shipment/Document rows.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
