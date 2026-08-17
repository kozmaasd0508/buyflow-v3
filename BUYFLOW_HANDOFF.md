# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile the stated release candidate with current `main` before changing runtime code.

**Last updated:** 2026-08-17 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Main before the v1.4 release:** `9bb89dcfa35b56b63a9ba4867110a51b62a4803e`  
**Current release candidate:** PR #147 — Generic order acceptance + quoted-history hardening  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when it can be recovered from GitHub/Supabase. Reconcile this snapshot with current `main`, current PR state, live data and the latest exact Render smoke.

Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns purchase, payment, shipment, invoice, warranty and return/refund emails into one safe Purchase record.

- frontend/mobile web: `apps/mobile`; Capacitor Android exists but APK is only needed when explicitly requested
- backend: TypeScript under `apps/api`
- production data: Supabase
- email: Nylas v3 webhook + durable/targeted scans
- recognition: deterministic-first; ambiguity => REVIEW
- AI is intentionally disabled in the production recognition path
- protocol knowledge lives separately from production activation
- release path: branch -> PR -> PR CI -> merge -> main CI -> exact Render smoke

## NON-NEGOTIABLE SAFETY

1. Purchase creation and lifecycle updates are separate decisions.
2. Lifecycle-only mail cannot create a Purchase.
3. Multiple plausible candidates => REVIEW; never guess.
4. Matching precedence remains exact order identity > tracking identity > conservative merchant/domain/time fallback.
5. Public/shared mailbox/platform sender cannot establish merchant identity alone.
6. Packing, label creation, pre-advice and `SHIPMENT_CREATED` do not prove physical shipment.
7. `OUT_FOR_DELIVERY` / arriving today is not `DELIVERED`.
8. `READY_FOR_PICKUP` is not `DELIVERED`.
9. Direct carrier evidence outranks merchant wording for logistics state.
10. Direct payment-provider evidence outranks merchant wording for payment state.
11. Invoice-provider/PDF evidence outranks generic merchant invoice wording.
12. Return request/approval is not settled RETURN; refund wording/request is not settled `REFUNDED` without stronger evidence.
13. Protocol evidence never bypasses classifier, resolution or write gates.
14. Unknown systems continue through conservative generic classification.
15. Unknown-merchant generic order evidence is currently shadow/review-only and cannot automatically create a Purchase.
16. Supabase DDL uses migrations; no unsafe historical writes.

## PROTOCOL LIBRARY / PRODUCTION STATE

Protocol Library foundation is under `apps/api/src/protocols/` with research knowledge under `/protocols`.

### Production protocol registry

`apps/api/src/protocols/registry.ts` remains intentionally empty. A protocol profile is not production-active merely because research/test evidence exists.

### Gate B — live read-only production shadow

Gate B is complete and observes exactly eight reviewed GREEN profiles against live Nylas `message.created` traffic:
- DPD
- FOXPOST
- Express One
- GLS
- MPL
- GymBeam
- Alza
- SimplePay

Gate B diagnostics are privacy-reduced and always `would_write:false`. Observer failures are isolated from normal ingestion. This does not authorize Purchase/shipment/payment/invoice/return/refund/warranty writes.

## GENERIC / UNKNOWN MERCHANT ORDER ENGINE

BuyFlow does **not** require a merchant profile for every webshop. Recognition has three conceptual layers:
1. known merchant profile,
2. known commerce platform/engine evidence,
3. generic unknown-merchant recognition.

The generic lane recognizes a merchant-owned order-confirmation structure using multiple independent signals such as stable order identity, explicit confirmation intent, total/currency, payment/shipping method, product rows and order-details sections.

Hard negatives include payment-only, invoice-only, courier-only, shipment-only, cart/marketing, quote/pro-forma, return/refund-only, account/security and unsupported lifecycle-only messages.

Generic parser identities matching `generic-order-confirmation-v...` are permanently excluded from trusted automatic evidence. New generic observations are forced to REVIEW/shadow and cannot directly create a Purchase.

## GENERIC v1.4 — PR #147

`generic-order-confirmation-v1.4` adds two safety layers learned from real mailbox evidence:

### 1. Contract / offer non-acceptance guard

Rich automatic acknowledgements are rejected from generic order creation when they explicitly say the message does not form a contract, does not accept the purchase offer/order, or merely confirms receipt. Positive wording elsewhere in the same email does not override an explicit non-acceptance statement.

Known merchant-specific semantics remain separate; the exact reviewed JatekBolt order-received adapter still runs before the generic hard-negative lane.

### 2. Quoted-history guard

Only the generic new-order parser receives a fresh-content view. Recognized historical reply/forward forms (`On ... wrote:`, Hungarian `... ezt írta:`, Original Message/Eredeti üzenet, forwarded headers, Outlook From/To/Subject blocks and `>` quoted lines) cannot create a second order candidate.

The original full email remains available to merchant/lifecycle parsers. A genuine new order above an older quoted thread still parses.

## LIVE v1.4 MAILBOX PROOF

A one-off read-only two-year Nylas audit was run against the v1.4 release candidate in temporary PR #148, which was closed **without merge**.

Scope:
- **9,438 messages**
- 472 pages
- not truncated
- 0 database writes
- 0 production-registry use
- 0 automatic Purchase writes
- 0 full-message fetch failures

Before v1.4 -> after v1.4:
- raw generic candidates: **12 -> 8**
- unprofiled candidates: **9 -> 5**
- distinct unprofiled sender families: **7 -> 4**
- strong unprofiled candidates: **2 -> 0**

Manual/fingerprint verification:
- Manna: 2 -> 2, retained
- Scitec: 1 -> 1, retained
- Zákány: 1 -> 1, retained
- Vitál-Kolor: 2 -> 1; original retained, quoted reply duplicate removed
- reviewed ABOUT YOU non-acceptance candidate removed
- both reviewed unsafe strong Tok-shop/Mulan-style candidates removed

The result exactly matched the intended safety correction: four unsafe/duplicate candidates disappeared and the five legitimate order-received/recorded observations survived.

Verification on the same code:
- **680/680 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

## RESEARCH COVERAGE

Research/test knowledge exists for major commerce engines, merchants, carriers, payments and invoicing providers, including WooCommerce, Shopify, UNAS, Shoprenter, eMAG, several Hungarian merchants, GLS/MPL/DPD/Express One/FOXPOST/Packeta, SimplePay/Barion/Stripe/PayPal and Billingo/Számlázz.hu.

Research or test status is not production authorization. The production protocol registry remains empty; Gate B is a separate hard-coded read-only allowlist for the eight reviewed GREEN profiles.

## CURRENT NEXT ARCHITECTURE GAP

After PR #147 is merged and exact main CI/Render smoke are green:

1. keep generic unknown-merchant order detection in shadow/review-only mode;
2. expand blind coverage with more unseen merchant/language/template families;
3. then build generic **lifecycle matching to an already-known Purchase** without allowing lifecycle-only mail to anchor a new Purchase;
4. only consider an automatic generic Purchase-write gate after a separate deliberate live false-positive study and explicit production authorization.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
