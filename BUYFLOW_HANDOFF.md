# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Older detail remains in Git history and `BUYFLOW_WORKLOG.md`.

**Last updated:** 2026-08-16 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current runtime main:** `3c648b87ff3c8335102af7b71e94cc05cefdedfd`  
**Last reconciled runtime code commit:** `3c648b87ff3c8335102af7b71e94cc05cefdedfd`  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when recoverable from GitHub/Supabase. Reconcile this snapshot with current `main`, live data and latest exact Render smoke.

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
5. Public/shared mailbox/platform sender cannot establish merchant identity alone.
6. Packing, pre-advice and `shipment_created` cannot prove physical shipment.
7. Phase-less generic shipment evidence cannot prove physical shipment.
8. Carrier pickup from sender is `shipped`, never recipient delivery.
9. Direct carrier evidence outranks merchant wording for logistics state but not Purchase ownership.
10. Direct payment-provider evidence outranks merchant wording for payment state.
11. Invoice-provider/PDF evidence outranks generic merchant invoice wording.
12. Refund requested/approved/merchant-reported is not necessarily settled `REFUNDED`.
13. Protocol evidence never bypasses classifier/resolution/write gates.
14. Unknown systems must continue through current generic classifier.
15. Documents preserve provenance; private PDFs use short signed URLs.
16. Supabase DDL via migrations; no unsafe historical writes.

## PROTOCOL / MERCHANT LIBRARY FOUNDATION — PR #99

Foundation runtime exists under `apps/api/src/protocols/` and knowledge docs under `/protocols`.

Foundation merge: `70b90b4cc227a018ce4f56afdd2319e6f002f6eb`.
- PR CI #487 green
- main CI #488 green
- exact Render smoke #382 green

Contract supports commerce/merchant/carrier/payment/invoicing profiles, semantic versions, 20 lifecycle candidates, structured identifiers, positive/negative evidence, provenance, explicit prohibitions and evidence-authority precedence.

Provenance levels:
- observed real email
- official documentation
- verified template
- community example
- inferred
- unknown

`inferred`/`unknown` alone can never be production-eligible. Production evidence threshold is 0.85 but never bypasses downstream safety.

Authority model:
- direct carrier > merchant/platform wording for logistics
- direct payment provider > merchant/platform wording for payment
- invoice provider/PDF > generic merchant invoice wording

Production registry is still intentionally empty: **none of the new research profiles changes live email classification yet**.

## PROTOCOL RESEARCH WAVE 1 — COMPLETE

### WooCommerce — PR #101

Research profile: `commerce.woocommerce@1.0.0-research.1`.

Source-backed findings/tests:
- Processing -> `ORDER_PROCESSING`, lifecycle only
- Failed order -> `PAYMENT_FAILED`
- Cancelled order -> `CANCELLED`
- historical `Customer_Invoice` class is actually Order details/payment request; only explicit pay/retry copy -> `PAYMENT_ACTION_REQUIRED`, never fiscal `INVOICE` by class name
- full/partial refund -> merchant `REFUNDED` candidate + `DO_NOT_MARK_REFUNDED`
- fulfillment-created -> merchant `SHIPPED` evidence, never `DELIVERED`
- Completed intentionally not mapped to `SHIPPED`/`DELIVERED`
- account-created/customer-note/reset-password hard negatives

PR #101 CI #491 green. Merged before later exact-smoked combined runtime.

### Shopify — PR #102

Research profile: `commerce.shopify@1.0.0-research.1`.

Key design:
- subjects/HTML are merchant-editable/localizable, so no invented default subject regexes
- `shopifyemail.com` is shared platform evidence only -> `OTHER`, `DO_NOT_CREATE_PURCHASE`, `DO_NOT_AUTO_LINK`
- notification semantics catalog covers Order confirmation, Shipping confirmation, Shipping update, Out for delivery, Delivered, cancellation, refund, pending-payment success/error, pickup, returns/exchanges and local delivery
- Shipping confirmation -> `SHIPMENT_CREATED`, not physical shipment
- Ready for pickup != Delivered
- Order refund -> `REFUNDED` candidate + `DO_NOT_MARK_REFUNDED`
- Picked up remains `OTHER` until BuyFlow taxonomy explicitly supports it
- Shopify `confirmation_number` is not assumed globally unique

PR #102 CI #493 green.

### UNAS + Shoprenter — PR #103

Merged runtime: `8f4e0aa343d5d8bcbe094333cbeda5c1c0cab955`.
- PR CI #495 green
- main CI #496 green
- exact Render smoke #390 green

UNAS research:
- no executable raw parser yet because statuses/content are highly customizable
- verified structural placeholders include order id, total, status, payment URL, tracking URL, package number and product block
- generic status-change mail remains `OTHER` until merchant-specific status semantics are verified
- package number/tracking link is identity evidence, not physical shipment
- failed/pending payment notification family is too ambiguous for a global failed/action rule

Shoprenter research:
- exact documented fallback `order@myshoprenter.hu` -> shared platform `OTHER` only; never merchant identity
- order-confirmation and status-change email content is editable
- `[SHOPRENTER_GO_TRACKING_LINK]` is tracking identity only, not physical progress
- `[PAYMENT_DESCRIPTION]` is payment-method/instruction evidence, not payment success
- documented hard-negative families include wishlist, stock, marketing and subscription notifications

### eMAG Hungary merchant research — PR #104

Merged current runtime: `3c648b87ff3c8335102af7b71e94cc05cefdedfd`.
- PR CI #497 green
- main CI #498 green
- exact Render smoke #392 green

Research profile/catalog: `merchant.hu.emag@1.0.0-research.1`, non-executable until real/first-party customer email fingerprints are verified.

Critical merchant-specific rules:
- eMAG Marketplace platform != seller identity; preserve eMAG vs Marketplace partner
- seller-side `Folyamatban` means preparation, not shipment
- AWB generation can move seller-side order to `Befejezett`; treat as at most `SHIPMENT_CREATED`, never `shipped_at`/`IN_TRANSIT`/`DELIVERED`
- one Purchase can have multiple parcels/AWBs -> preserve multiple Shipment identities
- easybox availability notification -> `READY_FOR_PICKUP`, never `DELIVERED`
- cancellation != refund
- return request/return received/inspection/approval are distinct from settled refund
- merchant/platform refund -> `REFUNDED` candidate + `DO_NOT_MARK_REFUNDED`
- failed online-card evidence cannot fabricate a Purchase
- invoice/warranty document availability != exact email/PDF document identity and != active warranty case

No stable official customer email sender + rendered subject/body set was found in first eMAG pass, so no subject strings were invented.

## FIRST WAVE STATUS / USER CHECKPOINT

The user explicitly asked to see the result after the first research phase before continuing to the next large group. **Stop here for review before proceeding to MediaMarkt/GymBeam/Notino or carrier/payment/invoice research.**

Research now exists for:
- WooCommerce
- Shopify
- UNAS
- Shoprenter
- eMAG HU

All remain research/unregistered, so live BuyFlow recognition behavior is unchanged by these profiles.

## USER-SUPPLIED 100-EMAIL BENCHMARK

Permanent baseline from PR #97:
- 100 emails = 70 purchase/lifecycle + 30 noise
- 30/30 noise safely excluded
- 0 wrong order/tracking identities
- 0 unsafe lifecycle promotions
- SHIPMENT_CREATED exact 3/4
- SHIPPED exact 6/6
- unseen generic purchase-related recognition 9/70

9/70 is a deliberately unseen-pattern benchmark, not overall production recall. Before any research profile is promoted, re-run this benchmark and require false Purchase=0, wrong auto-link=0 and no safety regression.

## EXISTING LIVE CAPABILITIES

- multi-Gmail OAuth and per-account 7/30/90-day scans
- deterministic Purchase/lifecycle for proven real merchants/carriers
- safe Purchase/Shipment identity resolution and REVIEW
- historical recovery lanes
- PDF attachment download from Nylas
- private Supabase Storage
- PDF text-layer extraction and invoice/order identity
- exact Purchase-document linking
- 60-second signed PDF opening in Purchase detail
- Jatekbolt `S26_044783.pdf` proven live
- scanned/raster PDF OCR not yet implemented

## CURRENT LIVE BACKLOG

Last verified before research-only work:
- REVIEW 34
- unlinked 10
- unresolved 44
- historical AI runs 98

Protocol research work did not scan inboxes or create Purchase/Shipment/Document rows.

## NEXT ACTION AFTER USER REVIEW

If user approves wave 1, choose one:
1. continue Hungarian merchant research: MediaMarkt -> GymBeam -> Notino; or
2. promote selected research knowledge toward executable `test` profiles by collecting/adding observed real rendered emails and running the 100-email benchmark.

Do not promote research profiles merely to improve recall; source-backed rendered fingerprints and hard negatives are required.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
