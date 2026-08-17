# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile the stated release candidate with current `main` before changing runtime code.

**Last updated:** 2026-08-17 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main before Generic Lifecycle v1.1 release:** `8c2737fe075f86671d70204563a2cfb612700fad`  
**Current release candidate:** PR #151 — Generic lifecycle sender-authority / physical-context hardening  
**Temporary audit:** PR #152 — closed without merge  
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
4. Generic Lifecycle uses exact hard anchors only; no domain+time fallback.
5. Public/shared mailbox/platform/provider/relay sender cannot establish merchant identity alone.
6. Known merchant senders remain under their dedicated deterministic parser; generic fallback cannot override them.
7. Packing, label creation, pre-advice and `SHIPMENT_CREATED` do not prove physical shipment.
8. Bare order-level `úton van` / `on its way` does not prove a physical parcel without independent fulfillment context.
9. `OUT_FOR_DELIVERY` / arriving today is not `DELIVERED`.
10. `READY_FOR_PICKUP` is not `DELIVERED`.
11. Direct carrier evidence outranks merchant wording for logistics state.
12. Direct payment-provider evidence outranks merchant wording for payment state.
13. Invoice-provider/PDF evidence outranks generic merchant invoice wording.
14. Return request/approval is not settled RETURN; refund wording/request is not settled `REFUNDED` without stronger evidence.
15. Protocol evidence never bypasses classifier, resolution or write gates.
16. Unknown-merchant generic order evidence remains shadow/review-only and cannot automatically create a Purchase.
17. Generic lifecycle evidence may attach only to an already-known Purchase through a hard anchor and cannot mutate Purchase/Shipment/Document state.
18. Supabase DDL uses migrations; no unsafe historical writes.

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

Gate B diagnostics are privacy-reduced and always `would_write:false`.

## GENERIC / UNKNOWN MERCHANT ORDER ENGINE

BuyFlow does **not** require a merchant profile for every webshop. Recognition has three conceptual layers:
1. known merchant profile,
2. known commerce platform/engine evidence,
3. generic unknown-merchant recognition.

`generic-order-confirmation-v1.4` recognizes merchant-owned order confirmations while blocking explicit contract/non-acceptance acknowledgements and quoted historical orders.

Generic order parser identities matching `generic-order-confirmation-v...` are permanently excluded from trusted automatic evidence. Generic order observations are REVIEW/shadow and cannot directly create a Purchase.

## GENERIC LIFECYCLE V1 — RELEASED ON MAIN

PR #149 merged as:
`8c2737fe075f86671d70204563a2cfb612700fad`

V1 is a last-resort lifecycle lane for unknown merchants. Supported observations include explicit shipped, in transit, out for delivery, ready for pickup, delivered and invoice tied to explicit order identity.

Hard-link rules:
1. exact normalized order number + exact merchant domain -> exactly one existing Purchase; or
2. unique exact tracking number already tied to one Purchase.

No domain+time fallback.

Three independent write barriers remain:
1. validation forced to REVIEW / Purchase creation false;
2. `purchase_sources.relation_type = generic_lifecycle`, ignored by trusted lifecycle state trigger;
3. `automatic-write-gate.ts` rejects every parser matching `generic-lifecycle-v...` even if accidentally marked validated/guardrailed.

V1 live audit PR #150 (closed without merge):
- 9,438 messages
- raw generic lifecycle matches: 43
- known-parser preemptions: 7
- true fallbacks: 36
- exact hard links: 1
- ambiguous: 0
- conflicts: 0
- unmatched / REVIEW: 35
- distinct fallback families: 14
- 703/703 tests PASS

The one hard link was the reviewed Sinsay order `15710474710`.

## GENERIC LIFECYCLE v1.1 — PR #151 RELEASE CANDIDATE

Manual review of the 35 unmatched / 14-family V1 remainder found useful merchant mail but also several unsafe role/semantic classes.

### Sender-authority hardening

`generic-lifecycle-v1.1` rejects generic merchant identity for evidence-driven infrastructure:
- `chameleoon.sk` shipment relay
- `szamlazz.hu` invoicing/provider channel
- `billingo.hu` invoicing/provider channel
- `myshoprenter.hu` shared platform fallback

It also rejects exact known merchant senders from the generic lifecycle lane via `identifyMerchantSender(...)`, so dedicated merchant parsers remain the sole semantic authority for those merchants.

### XLS Futár sender role

`xlsfutar.hu` is classified as carrier infrastructure in `sender-role.ts`. This only prevents generic merchant identity; it does not add an XLS lifecycle parser, production protocol profile, or automatic logistics write.

### Physical-shipment hardening

Package-level wording such as `csomagod úton van` remains strong physical evidence when a hard purchase identity exists.

Order-level wording such as `rendelésed úton van` / `your order is on its way` now additionally requires physical fulfillment context such as package, courier, shipment, parcel, tracking or consignment evidence.

This blocks a reviewed real Bódi Tesók VIP event-ticket email that said the order was `úton van` despite having no parcel/courier/tracking lifecycle.

### Permanent verification before documentation

Exact PR #151 runtime head `19126ad0d15a6787d19ca5cb87512adb8cba431a` passed:
- **710/710 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

## v1.1 LIVE MAILBOX PROOF — PR #152

Temporary PR #152 was based on the exact v1.1 runtime candidate, ran read-only, and was closed **without merge**.

Scope:
- **9,442 messages** / 473 pages / not truncated
- 19 Purchases + 16 Shipments loaded read-only
- 0 DB writes
- 0 production-registry use
- 0 full-message fetch failures
- 0 rate-limit retries

V1 -> v1.1 aggregate live delta (mailbox grew by 4 messages between runs):
- raw candidates: **43 -> 22**
- known-parser preemptions: **7 -> 0**
- fallback candidates: **36 -> 22**
- hard links: **1 -> 1**
- ambiguous: **0 -> 0**
- conflicts: **0 -> 0**
- unmatched / REVIEW: **35 -> 21**
- distinct fallback families: **14 -> 11**
- shipment candidates: **29 -> 16**
- invoice/receipt: **7 -> 6**
- in transit: **16 -> 6**
- shipped: **12 -> 9**
- ready for pickup: **1 -> 1**

The previously proven Sinsay hard link survived. No ambiguity/conflict was introduced.

Detailed evidence:
`protocols/GENERIC-LIFECYCLE-V11-REVIEW-HARDENING-2026-08-17.md`

## RESEARCH COVERAGE

Research/test knowledge exists for WooCommerce, Shopify, UNAS, Shoprenter, eMAG, several Hungarian merchants, GLS/MPL/DPD/Express One/FOXPOST/Packeta, SimplePay/Barion/Stripe/PayPal and Billingo/Számlázz.hu.

Research or test status is not production authorization. Production protocol registry remains empty; Gate B is separate read-only observation.

## CURRENT RELEASE GATE

Before merging PR #151:
1. documentation-triggered CI must be green on the exact final PR head;
2. PR diff must contain only permanent runtime/tests/docs — no audit script/workflow, migration or production activation;
3. merge with expected exact head SHA;
4. require exact main-push CI and exact Render Webhook Smoke on the merge SHA;
5. verify production protocol registry remains empty.

## NEXT ARCHITECTURE GAP AFTER v1.1 RELEASE

Remaining live review set: **21 unmatched observations / 11 sender families**.

Next work:
1. manually cluster those 11 remaining families;
2. distinguish legitimate merchant lifecycle templates from residual infrastructure/noise;
3. add narrow rules only with direct evidence;
4. keep generic lifecycle state mutation disabled;
5. require a separate zero-wrong-link / zero-unsafe-promotion study before any stronger write capability.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
