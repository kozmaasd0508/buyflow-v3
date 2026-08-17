# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile this snapshot with current GitHub/Supabase/Render state before changing runtime code.

**Last updated:** 2026-08-17 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current released main before v1.2:** `3a2b4ce07c0a065109cea2d54b146673be12d5b9`  
**Current release candidate:** PR #153 — Generic Lifecycle v1.2 future/prerequisite guard  
**Final temporary audit:** PR #155 — closed without merge  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## RESUME CONTRACT

Do not ask the user to retell BuyFlow history when GitHub/Supabase can recover it. Minimal resume phrase: **Folytasd a BuyFlowot a GitHubból.**

## PRODUCT / ARCHITECTURE

BuyFlow turns purchase, payment, shipment, invoice, warranty and return/refund emails into one safe Purchase record.

- frontend/mobile web: `apps/mobile`
- backend: TypeScript under `apps/api`
- production data: Supabase
- email: Nylas v3 webhook + durable/targeted scans
- recognition: deterministic-first; ambiguity => REVIEW
- AI is intentionally disabled in production recognition
- Protocol Library knowledge is separate from production activation
- release path: branch -> PR -> PR CI -> live read-only audit when needed -> merge -> main CI -> exact Render smoke

## NON-NEGOTIABLE SAFETY

1. Purchase creation and lifecycle updates are separate decisions.
2. Lifecycle-only mail cannot create a Purchase.
3. Multiple plausible candidates => REVIEW; never guess.
4. Generic Lifecycle hard links only by exact order+merchant-domain or unique exact existing tracking.
5. No generic domain+time fallback.
6. Public/shared mailbox/platform/provider/relay senders cannot establish merchant identity alone.
7. Known merchants stay under their dedicated parser; generic fallback cannot override them.
8. Packing, label generation, pre-advice and `SHIPMENT_CREATED` do not prove physical shipment.
9. Future, conditional or prerequisite fulfillment wording does not prove the lifecycle state is true now.
10. Bare order-level `úton van` requires independent physical fulfillment context.
11. `OUT_FOR_DELIVERY` is not `DELIVERED`.
12. `READY_FOR_PICKUP` is not `DELIVERED`.
13. Return request/approval is not settled RETURN; refund wording/request is not settled `REFUNDED` without stronger evidence.
14. Generic order and generic lifecycle parser families are permanently shadow/review-only at the automatic write gate.
15. Generic lifecycle may attach only to an already-known Purchase through a hard anchor and cannot mutate Purchase/Shipment/Document state.
16. Production protocol activation is explicit; research/test status alone is never production authorization.

## PRODUCTION PROTOCOL STATE

`apps/api/src/protocols/registry.ts` is intentionally empty:

```ts
const PROTOCOL_PROFILES: ProtocolProfile[] = [];
```

Gate B separately observes eight reviewed GREEN profiles read-only:
- DPD
- FOXPOST
- Express One
- GLS
- MPL
- GymBeam
- Alza
- SimplePay

Gate B is privacy-reduced and `would_write:false`.

## GENERIC ORDER ENGINE

`generic-order-confirmation-v1.4` is the current unknown-merchant order fallback.

It blocks:
- explicit non-acceptance / no-contract acknowledgements
- historical quoted orders in replies/forwards

Generic order evidence remains REVIEW/shadow-only and cannot directly create a Purchase.

## GENERIC LIFECYCLE RELEASE HISTORY

### V1 — PR #149

Merged as:
`8c2737fe075f86671d70204563a2cfb612700fad`

Added last-resort unknown-merchant lifecycle recognition plus hard-anchor linking to existing Purchases.

V1 live audit:
- 9,438 messages
- 36 true fallback candidates
- 1 hard link
- 35 REVIEW
- 14 families
- 0 ambiguity / 0 conflict

### v1.1 — PR #151

Merged as:
`3a2b4ce07c0a065109cea2d54b146673be12d5b9`

Added sender-authority and physical-context hardening:
- `chameleoon.sk`, `szamlazz.hu`, `billingo.hu`, `myshoprenter.hu` blocked as generic merchant identity
- `xlsfutar.hu` classified as carrier infrastructure
- known merchant senders blocked from generic lifecycle fallback
- bare order-level `úton van` requires physical context
- real Bódi VIP digital-ticket false shipment blocked

v1.1 release passed:
- 710/710 tests
- exact main CI
- exact Render smoke #529

v1.1 live audit:
- 9,442 messages
- 22 fallback candidates
- 1 hard link
- 21 REVIEW
- 11 families
- 0 ambiguity / 0 conflict

## GENERIC LIFECYCLE v1.2 — PR #153 RELEASE CANDIDATE

Parser fingerprint:
`generic-lifecycle-v1.2`

Goal: prevent future, conditional and prerequisite explanatory language from becoming a current lifecycle state.

Reviewed real regressions:
- Oázis procurement: `értesítünk, amint rendelésed átvehető` => not READY_FOR_PICKUP
- Oázis order-recorded guidance: `csak akkor indulj el ... miután kaptál értesítést, hogy a rendelésed átvehető` => not READY_FOR_PICKUP
- Klarstein processing/FAQ: `számlát ... küldjük, mikor a rendelését átadtuk a futárszolgálatnak` => not SHIPPED

Implementation keeps identity extraction on the full fresh message but evaluates lifecycle/invoice signals on a narrow current-evidence view with recognized future/prerequisite statements removed.

A positive regression proves that a real current courier handoff remains SHIPPED even if the same email separately explains a future pickup notification.

### Permanent code verification

Exact runtime head before documentation:
`8b38b023f6656d25b11804ea09cb5c98a474e101`

- **714/714 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

### Final live proof — temporary PR #155

PR #155 was created from the exact green v1.2 runtime head and closed **without merge**.

Scope:
- **9,449 messages**
- 473 pages
- not truncated
- 19 existing Purchases + 16 Shipments loaded read-only
- 0 database writes
- 0 production-registry use

Result:
- raw/fallback generic lifecycle: **20**
- exact order+domain hard links: **1**
- tracking hard links: **0**
- unmatched / REVIEW: **19**
- distinct fallback families: **9**
- ambiguous: **0**
- conflicts: **0**
- shipment observations: **14**
- invoice/receipt: **6**
- shipped: **8**
- in transit: **6**
- READY_FOR_PICKUP fallback: **0**

Acceptance proof:
- no 2025-10-14 Oázis future/prerequisite pickup row remains
- no 2025-11-26 Klarstein future shipment row remains
- previously proven exact Sinsay hard link remains **1**

Detailed evidence:
`protocols/GENERIC-LIFECYCLE-V12-FUTURE-GUARD-2026-08-17.md`

## IMPORTANT INTERPRETATION OF THE REMAINING 19 REVIEW OBSERVATIONS

The 19 remaining REVIEW observations are not a failure metric to force toward zero. Manual mapping showed they are legitimate purchase-lifecycle evidence for real merchants but lack a safe existing Purchase anchor.

Known remaining legitimate classes include Sinsay, fizz marketplace invoices, Rossmann and several singleton merchant shipment families.

Do not filter legitimate unanchored lifecycle mail merely to reduce the REVIEW count.

## CURRENT RELEASE GATE FOR PR #153

Before declaring v1.2 released:
1. documentation-triggered CI must pass on the exact final PR head;
2. PR scope must contain only permanent runtime/tests/docs — no audit script/workflow, migration or production registry change;
3. merge with the exact expected head SHA;
4. verify exact main CI on the merge SHA with 714/714 tests;
5. verify production protocol registry remains empty;
6. verify exact Render Webhook Smoke on the same merge SHA.

## NEXT HIGH-VALUE TASK AFTER v1.2 RELEASE

Do **not** keep shaving legitimate REVIEW count.

Next architecture task: **Generic Lifecycle multi-observation shadow V1**.

Real emails can independently contain both:
- shipment/logistics evidence, and
- invoice/document evidence

in the same message (examples observed in real mailbox include Irodamarket, Under Armour, R-V Webshop and eDuna-style combined communications).

Next design should:
- emit separate shadow/REVIEW observations from one email
- keep exact hard-link rules unchanged
- keep Purchase creation disabled
- keep Purchase/Shipment/Document state mutation disabled
- require a new read-only live audit before merge

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation
