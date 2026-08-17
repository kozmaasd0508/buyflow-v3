# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile the stated release candidate with current `main` before changing runtime code.

**Last updated:** 2026-08-17 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main before Generic Lifecycle V1 release:** `723f7ed523cb8a4cd2de82676c4cac0e992d0e2e`  
**Current release candidate:** PR #149 — Generic lifecycle hard-anchor linking  
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
- release path: branch -> PR -> PR CI -> live read-only audit when needed -> merge -> main CI -> exact Render smoke

## NON-NEGOTIABLE SAFETY

1. Purchase creation and lifecycle updates are separate decisions.
2. Lifecycle-only mail cannot create a Purchase.
3. Multiple plausible candidates => REVIEW; never guess.
4. General matching precedence is exact order identity > tracking identity > conservative merchant/domain/time fallback, but **Generic Lifecycle V1 does not allow domain+time fallback at all**.
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
15. Unknown-merchant generic order evidence remains shadow/review-only and cannot automatically create a Purchase.
16. Generic lifecycle evidence may attach only to an already-known Purchase through a hard anchor and cannot mutate Purchase/Shipment/Document state in V1.
17. Supabase DDL uses migrations; no unsafe historical writes.

## PROTOCOL LIBRARY / PRODUCTION STATE

Protocol Library foundation is under `apps/api/src/protocols/` with research knowledge under `/protocols`.

### Production protocol registry

`apps/api/src/protocols/registry.ts` remains intentionally empty. A protocol profile is not production-active merely because research/test evidence exists.

### Gate B — live read-only production shadow

Gate B observes exactly eight reviewed GREEN profiles against live Nylas `message.created` traffic:
- DPD
- FOXPOST
- Express One
- GLS
- MPL
- GymBeam
- Alza
- SimplePay

Gate B diagnostics are privacy-reduced and always `would_write:false`. Observer failures are isolated from normal ingestion.

## GENERIC / UNKNOWN MERCHANT ORDER ENGINE

BuyFlow does **not** require a merchant profile for every webshop. Recognition has three conceptual layers:
1. known merchant profile,
2. known commerce platform/engine evidence,
3. generic unknown-merchant recognition.

`generic-order-confirmation-v1.4` recognizes a merchant-owned order-confirmation structure using multiple independent signals while blocking explicit contract/non-acceptance acknowledgements and quoted historical orders.

Generic parser identities matching `generic-order-confirmation-v...` are permanently excluded from trusted automatic evidence. New generic order observations are REVIEW/shadow and cannot directly create a Purchase.

### v1.4 live proof

One-off read-only PR #148 scanned 9,438 messages and was closed without merge:
- raw generic candidates: 12 -> 8
- unprofiled candidates: 9 -> 5
- distinct unprofiled families: 7 -> 4
- strong unprofiled candidates: 2 -> 0
- 680/680 tests passed on that release

Current main `723f7ed...` is the merged v1.4 release and its exact Render Webhook Smoke eventually passed after Render deployment delay.

## GENERIC LIFECYCLE V1 — PR #149

`generic-lifecycle-v1` is a last-resort lifecycle lane for an unknown merchant after all known deterministic lifecycle/merchant/order parsers have declined the message.

Supported observations:
- explicitly shipped
- in transit
- out for delivery
- ready for pickup
- delivered
- invoice tied to an explicit order identity

### Hard-link rules

V1 may attach the source to an **existing Purchase only** through:
1. exact normalized order number + exact merchant domain, resolving to exactly one Purchase; or
2. unique exact existing tracking number already tied to one Purchase.

No domain+time fallback is allowed.

Outcomes:
- multiple hard-anchor matches => REVIEW / `ambiguous`
- order and tracking anchors disagree => REVIEW / `conflict`
- no hard anchor => REVIEW / `unmatched`

### Three independent write barriers

Even after a safe source link:
1. generic lifecycle source remains `validation_status = review` and `eligible_for_purchase_creation = false`;
2. the relation is `purchase_sources.relation_type = generic_lifecycle`, which the trusted shipment/delivery state trigger ignores;
3. `automatic-write-gate.ts` permanently rejects parser versions matching `generic-lifecycle-v...`, even if future code accidentally marks them validated/guardrailed.

Therefore V1 can attach source evidence but cannot create a Purchase or mutate Purchase/Shipment/Document state.

### Real Sinsay grammar proof

Production data contains a Sinsay Purchase with order `15710474710`. A later real Sinsay email states that the `15710474710 rendelést elküldték`. This exposed a Hungarian word-order gap where the identifier precedes `rendelést`; the parser was hardened for that explicit form without adding a weak fallback.

### Live mailbox proof — temporary PR #150

PR #150 was read-only and closed **without merge** after evidence capture.

Final scope:
- **9,438 messages** / 472 pages / not truncated
- 19 existing Purchases and 16 existing Shipments loaded read-only
- 0 database writes
- 0 production-registry use

Final funnel:
- raw generic lifecycle matches: **43**
- preempted by existing deterministic parsers: **7**
- true generic lifecycle fallbacks: **36**
- exact order+domain hard links: **1**
- exact tracking hard links: **0**
- ambiguous: **0**
- conflicts: **0**
- unmatched / REVIEW: **35**
- distinct fallback sender fingerprints: **14**

Fallback mix:
- shipment: 29
- invoice/receipt: 7
- in transit: 16
- explicitly shipped: 12
- ready for pickup: 1

Verification on the same final code:
- **703/703 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

Detailed design/evidence: `protocols/GENERIC-LIFECYCLE-LINK-V1-2026-08-17.md`.

## RESEARCH COVERAGE

Research/test knowledge exists for major commerce engines, merchants, carriers, payments and invoicing providers, including WooCommerce, Shopify, UNAS, Shoprenter, eMAG, several Hungarian merchants, GLS/MPL/DPD/Express One/FOXPOST/Packeta, SimplePay/Barion/Stripe/PayPal and Billingo/Számlázz.hu.

Research or test status is not production authorization. The production protocol registry remains empty; Gate B is a separate hard-coded read-only allowlist for the eight reviewed GREEN profiles.

## CURRENT NEXT ARCHITECTURE GAP

After PR #149 is merged and exact main CI/Render smoke are green:

1. keep generic unknown-merchant order creation shadow/review-only;
2. keep generic lifecycle **state mutation disabled**;
3. manually review/cluster the remaining generic lifecycle unmatched sender families to separate useful templates from review noise;
4. expand unseen language/template coverage only with hard anchors;
5. add/measure generic lifecycle shadow diagnostics before considering any state-mutation proposal;
6. any automatic generic Purchase write or generic lifecycle state mutation requires a separate live false-positive study and explicit production authorization.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
