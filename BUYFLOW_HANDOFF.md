# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older detail remains in Git history and `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-16 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current runtime main:** `70b90b4cc227a018ce4f56afdd2319e6f002f6eb`  
**Last reconciled runtime code commit:** `70b90b4cc227a018ce4f56afdd2319e6f002f6eb`  
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
9. Direct carrier evidence outranks merchant wording for logistics state, but does not establish Purchase ownership by itself.
10. Direct payment-provider evidence outranks merchant wording for payment state.
11. Invoice-provider/PDF evidence outranks generic merchant invoice wording.
12. Protocol evidence never bypasses classifier/resolution/write gates.
13. Documents preserve provenance; private PDFs remain private and use short signed URLs.
14. Supabase DDL via migrations; no unsafe historical writes.

## NEW — PROTOCOL / MERCHANT LIBRARY FOUNDATION / PR #99

The versioned local knowledge layer requested by the user is now implemented as a foundation.

Runtime merge: `70b90b4cc227a018ce4f56afdd2319e6f002f6eb`.
- PR #99 final CI #487 green
- main CI #488 green
- exact Render smoke #382 green for the exact runtime commit

Runtime code lives in `apps/api/src/protocols/` and knowledge documentation under `/protocols`.

Foundation contract supports:
- kinds: commerce, merchant, carrier, payment, invoicing
- lifecycle candidates: ORDER_CREATED, ORDER_PROCESSING, ORDER_PACKING, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, DELIVERY_FAILED, DELAYED, CANCELLED, PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_ACTION_REQUIRED, INVOICE, RETURN, REFUNDED, WARRANTY, OTHER
- stable protocol id + semantic version
- structured order/tracking/invoice/payment-reference identifiers
- positive evidence + negative evidence
- explicit prohibitions such as `DO_NOT_CREATE_PURCHASE`, `DO_NOT_SET_SHIPPED_AT`, `DO_NOT_MARK_DELIVERED`
- provenance: observed real email / official docs / verified template / community example / inferred / unknown
- production evidence minimum confidence 0.85
- `inferred` or `unknown` evidence alone is never production-eligible
- source-authority matrix for logistics/payment/invoice evidence
- exact trusted domain or true-subdomain matching; attacker lookalikes rejected
- profile validation for semver, sources, regexes, identifier regexes and confidence

**Important:** the production protocol registry is intentionally empty in Foundation V1. Therefore PR #99 changes no existing email recognition behavior and performs no new writes. Unknown systems continue through the current generic classifier.

CI itself exposed two foundation mistakes before merge:
1. an `Object.entries()` typing issue — fixed without changing semantics;
2. an intentionally example order-ID regex was too broad and captured `visszaigazol...`; the fixture was tightened to require explicit `Rendelésszám:` plus a digit-bearing identifier. This is the standard to follow for real protocol profiles.

## PROTOCOL LIBRARY RESEARCH ORDER

First commerce-platform wave:
1. WooCommerce
2. Shopify
3. UNAS
4. Shoprenter

Then first Hungarian merchant wave:
1. eMAG
2. MediaMarkt
3. GymBeam
4. Notino

Every new profile must be source-verified, versioned, have positive + hard-negative fixtures, and start in `research`/`test` until it is safe to promote. Do not add a broad keyword rule merely to improve benchmark recall.

## USER-SUPPLIED 100-EMAIL BENCHMARK / PR #97

Permanent regression corpus:
- 100 emails
- 70 purchase/lifecycle events
- 30 noise/hard negatives
- 10 complete purchase journeys
- 20 expected labels

First blind run found and fixed two real carrier defects: sender pickup had been misread as delivered, and phase-less shipment evidence could count as physical progress.

Final safety baseline after PR #97:
- 30/30 noise safely unrecognized
- 0 wrong order/tracking identities
- 0 unsafe lifecycle promotions
- 0 recognized pre-advice without explicit `shipment_created`
- SHIPMENT_CREATED exact: 3/4
- SHIPPED exact: 6/6
- new generic purchase-related corpus recognition: 9/70

9/70 is a deliberate unseen-pattern benchmark, not overall BuyFlow production recall. Use it to measure safe improvements from the Protocol Library while preserving false Purchase=0 and wrong link=0.

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

Last verified source-email backlog before benchmark/foundation-only work:
- REVIEW: 34
- unlinked: 10
- unresolved: 44
- historical AI runs: 98

PR #99 did not scan production inboxes or create Purchase/Shipment/Document rows.

## NEXT ACTION

Research **WooCommerce** from primary/official sources. Capture customer-facing email types, triggers/order-state semantics, default subjects/headings/placeholders, order-detail structure, customization caveats, payment/refund behavior and hard negatives. Add it as a source-backed `research` or `test` protocol with fixtures first; do not promote to production until safety and benchmark effects are measured.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
