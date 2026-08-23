# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with current GitHub/Supabase/Render state before changing runtime code.

**Last updated:** 2026-08-20 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current released main:** `73fe594d281df31307547585f6204f34d92a4039` — Generic Lifecycle v1.2  
**Current release candidate:** PR #156 — Generic Lifecycle v1.3 multi-observation shadow  
**Final temporary audit:** PR #157 — closed without merge  
**Production preview:** `https://buyflow-v3-api-dev.onrender.com/app/`  
**API health:** `https://buyflow-v3-api-dev.onrender.com/health`

## CURRENT SHADOW AUDIT STATE — 2026-08-20

- Shadow branch head: `2f8e3e2d39c8e9e94fce9cf671a47d0e401a48ce` (PR #191).
- Frozen Gmail v6 holdout: 50 commerce + 50 hard noise, excluding the prior v4/v5 sets and locked before v6 audit code or tuning.
- PR #190 added the Gmail-label-locked `/audit-v6` harness; detector/parser runtime was unchanged.
- First v6 blind run: TP 42 / FN 8 / FP 0 / TN 50; precision 100%, recall 84%, 100/100 coverage.
- The eight false negatives were two Express One payment receipts, three Google Play subscription lifecycle notices, two MPL/Posta out-for-delivery notices (one via Allegro mail relay), and one Shopbuilder shipped notice.
- PR #191 added only exact sender/domain + explicit subject/body lifecycle-evidence rules, plus positive and fail-closed negative regression tests. Broad generic matching and the frozen v6 fixtures were unchanged.
- Live Render v6 regression on `2f8e3e2d39c8e9e94fce9cf671a47d0e401a48ce`: TP 50 / FN 0 / FP 0 / TN 50; precision 100%, recall 100%, 100/100 coverage.
- Audit remained read-only: 0 production writes and 0 AI calls.
- GitHub Actions did not publish checks for PRs #190/#191; live Render commit verification and the read-only audit are the recorded runtime proof.
- The v4, v5 and v6 sets are regression evidence, not fresh blind sets. Any further generalization claim requires another newly frozen holdout.

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
