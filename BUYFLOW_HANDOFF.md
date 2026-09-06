# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with current GitHub/Supabase/Render state before changing runtime code.

**Last updated:** 2026-09-06 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current released main:** `73fe594d281df31307547585f6204f34d92a4039` — Generic Lifecycle v1.2  
**Current release candidate:** PR #156 — Generic Lifecycle v1.3 multi-observation shadow  
**Final temporary audit:** PR #157 — closed without merge  
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
16. Multiple semantic observations from one email never grant stronger write authority; they remain independent REVIEW facts on one source email.
17. Production protocol activation is explicit; research/test status alone is never production authorization.

## PRODUCTION PROTOCOL STATE

`apps/api/src/protocols/registry.ts` remains intentionally empty:

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

It blocks explicit no-contract/non-acceptance acknowledgements and quoted historical order content. Generic order evidence remains REVIEW/shadow-only and cannot directly create a Purchase.

## GENERIC LIFECYCLE RELEASE HISTORY

### V1 — PR #149

Merged as `8c2737fe075f86671d70204563a2cfb612700fad`.

Added last-resort unknown-merchant lifecycle recognition plus exact hard-anchor linking to existing Purchases.

Live audit: 9,438 messages, 36 fallbacks, 1 hard link, 35 REVIEW, 0 ambiguity/conflict.

### v1.1 — PR #151

Merged as `3a2b4ce07c0a065109cea2d54b146673be12d5b9`.

Added sender-authority/physical-context hardening: provider/relay exclusions, XLS Futár carrier role, known-merchant fallback blocking, physical context requirement for bare order-level `úton van`, and digital-ticket false-shipment protection.

Live audit: 9,442 messages, 22 fallbacks, 1 hard link, 21 REVIEW, 0 ambiguity/conflict.

### v1.2 — PR #153

Merged as `73fe594d281df31307547585f6204f34d92a4039`.

Prevented future/prerequisite fulfillment language from becoming a current lifecycle state.

Real regressions:
- Oázis future pickup wording => not READY_FOR_PICKUP
- Oázis pickup prerequisite instruction => not READY_FOR_PICKUP
- Klarstein future courier-handoff FAQ => not SHIPPED

Release:
- **714/714 tests PASS**
- main CI #645 SUCCESS
- Render Webhook Smoke #540 SUCCESS

Final live audit:
- 9,449 messages
- 20 fallback source emails
- 1 hard link
- 19 legitimate REVIEW
- 0 ambiguity/conflict
- 14 shipment + 6 invoice observations
- 0 READY_FOR_PICKUP false positives

## GENERIC LIFECYCLE v1.3 — PR #156 RELEASE CANDIDATE

Parser fingerprint:
`generic-lifecycle-v1.3`

Goal: preserve multiple independent semantic facts from one transactional email while keeping one source-email record and zero added write authority.

New parser API:
`parseGenericLifecycleObservations()`

Compatibility API remains:
`parseGenericLifecycleEmail()`

One source email can now contain separate REVIEW observations such as:
- `invoice_or_receipt`
- `shipment:shipped`

Top-level compatibility keeps invoice first for combined invoice+shipment mail.

Persistence fields:
- `generic_lifecycle_observations`
- `generic_lifecycle_observation_count`
- `generic_lifecycle_multi_observation`

Every nested observation remains REVIEW/link-only and explicitly declares no Purchase/Shipment/Document write authority.

### Real reviewed combined patterns

Regression coverage comes from real mailbox patterns:
- Irodamarket — order identity + DPD handoff + tracking + attached invoice
- R-V Webshop — electronic invoice + exact order + courier handoff
- eDuna — formal Hungarian `számú rendelését` + courier handoff + attached invoice

Additional narrow Hungarian grammar support was added for forms such as:
- `14107 számú rendelésed`
- `89445 számú rendelését`
- explicit `rendelésed átadtuk ... futárszolgálatnak`

### Persistence safety

A circular JSON-reference risk was found before merge and fixed. `buildGenericLifecycleValidatedEnvelope()` now creates a separate top-level compatibility envelope instead of reusing the first nested observation object.

Dedicated tests prove multi/single observation envelopes are JSON serializable.

### Permanent code verification

Exact runtime head before documentation:
`0b949bd5a0a9e1cd61740ac6cad8b4d0e1a24874`

CI #655:
- **723/723 API tests PASS**
- 0 fail
- API typecheck/build PASS
- mobile typecheck/build PASS

### Final live proof — PR #157

PR #157 was closed **without merge**.

Exact audit CI #657:
- **9,450 messages** / 473 pages / not truncated
- source emails: **24**
- semantic observations: **25**
- source emails with 1 observation: **23**
- source emails with 2 observations: **1**
- live multi-observation sources: **1**
- exact order+domain hard links: **1**
- tracking hard links: **0**
- ambiguity: **0**
- conflicts: **0**
- unmatched / REVIEW source emails: **23**
- shipment observations: **18**
- invoice/receipt observations: **7**
- shipped: **13**
- in transit: **5**
- READY_FOR_PICKUP: **0**
- database writes: **0**

The one live multi-observation source had the shape `invoice_or_receipt + shipment:shipped`, contained both order and tracking hard identities, and aligns with the manually reviewed real Irodamarket email.

The prior exact Sinsay hard link survived. Oázis/Klarstein future-state false positives did not reappear.

Detailed evidence:
`protocols/GENERIC-LIFECYCLE-V13-MULTI-OBSERVATION-2026-08-17.md`

## CURRENT RELEASE GATE FOR PR #156

Before declaring v1.3 released:
1. final documentation-triggered CI must pass on the exact latest PR head;
2. PR scope must contain only permanent runtime/tests/docs — no audit script/workflow, migration or registry activation;
3. merge only with exact expected head SHA;
4. verify exact main CI on merge SHA with 723/723 tests;
5. verify production protocol registry remains empty;
6. verify exact Render Webhook Smoke on the same merge SHA.

## NEXT HIGH-VALUE TASK AFTER v1.3 RELEASE

Stop doing generic REVIEW-count cleanup unless new evidence exposes an actual safety bug.

Next domain: **payment evidence + safe purchase linking**.

Research/implementation should distinguish:
- PAYMENT_SUCCESS
- PAYMENT_FAILED
- PAYMENT_ACTION_REQUIRED
- refund-related evidence

Payment-only email must never create a Purchase. Payment provider identity must not become merchant identity, and provider references must not be guessed as global BuyFlow order IDs.

## QUALITY TARGET

- >=95% true purchase recognition across diverse real mailboxes
- false automatic Purchase = 0
- wrong automatic link = 0
- duplicate Purchase/Shipment/Document = 0
- REVIEW preferred over unsafe automation

## 2026-09-06 — LOCAL GEMMA CLEAN BLIND TEST + V17 DIRECTION

Local model: `gemma3:12b` via Ollama. This experiment is local only: Gmail 0, BuyFlow writes 0, Production OFF.

### Chat test setup

The previous BuyFlow chat system prompt contained many lifecycle boundary rules. A clean blind-test chat was created with a neutral system prompt only:

> Analyze the information carefully, reason from the actual meaning/evidence, do not invent missing facts or relationships, and say when evidence is insufficient.

No BuyFlow lifecycle definitions such as SHIPMENT_CREATED / SHIPPED / OUT_FOR_DELIVERY / READY_FOR_PICKUP / DELIVERED were included in the system prompt.

Clean-chat code commit:
`739faf17d44f72a41ef799ad16e3968cac32f91e`

Pinned launcher commit:
`8339d481aa0eeebf7788f8a015ef1b92881b5f22`

### Clean 20-email blind test result

The clean Gemma understood the important semantic boundaries without being taught them explicitly:
- electronic shipment data exists but parcel physically not handed over;
- carrier physically received parcel;
- parcel is moving through carrier network;
- parcel is on the delivery courier vehicle / being delivered today;
- parcel is available at locker/pickup point;
- successful delivery;
- marketing/security messages are not purchase lifecycle events;
- a survey may still be linked to an existing parcel while not creating a new lifecycle event;
- merchant/mailbox-owner outbound courier pickup is not a buyer purchase;
- two separate orders on the same platform were kept distinct in the per-email analysis.

Important concrete checks from the clean test:
- E04 correctly identified as actual carrier pickup.
- E05 correctly identified as parcel currently with the delivery courier.
- E13 correctly identified as ready for pickup.
- E17 correctly linked to an existing tracking number but treated as non-purchase feedback/survey.
- E18 correctly identified as seller/outbound pickup, not buyer purchase.

### Important failure

There was one serious summary-consistency error: E19 (`PEP-204947` cancellation) was correctly classified per-email, but the final aggregated purchase-history section also inserted E19 into `PEP-204881` and incorrectly marked that separate purchase as cancelled.

This is interpreted as an aggregation/consistency failure, not a basic email-understanding failure.

There was also a smaller provenance wording error in the final answers: some emails chained by tracking were described as if they had been linked directly by order number.

### Current conclusion

The neutral/short prompt produced better natural semantic reasoning on several lifecycle boundaries than the previous long BuyFlow teaching prompt. The long prompt appears to have over-constrained Gemma and made it overly cautious, e.g. refusing SHIPPED-like semantics even when explicit handoff evidence existed.

Do NOT conclude that the clean Gemma is production-ready. This was one synthetic blind test and it still had a cross-email aggregation consistency failure.

### V17 design direction

Build V17 as a separate experimental path. Do not overwrite the stable V15 baseline.

V17 principle:
1. Let Gemma interpret the email naturally.
2. Give it only the minimal BuyFlow event taxonomy/output contract needed to map meaning into BuyFlow labels.
3. Require evidence for links; no guessed relationships.
4. Add deterministic validation/consistency checks around aggregation and identity linking.
5. Avoid long case-by-case teaching rules unless a real failure proves they are necessary.
6. Develop on REAL120 + synthetic boundary cases only.
7. Do not tune on spent BLIND40 V1.
8. Freeze V17 before testing on a new untouched BLIND40 V2 or EXTERNAL20.
9. Production remains OFF unless explicitly authorized.

Desired V17 experiment shape:
`Gemma natural understanding + minimal BuyFlow taxonomy + evidence-only linking + deterministic consistency validation`.
