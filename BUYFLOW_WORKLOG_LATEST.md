# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous detailed entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-17 — Generic Lifecycle v1.1 review hardening

### Goal

Use the real Generic Lifecycle V1 review remainder to eliminate unsafe sender-role and weak physical-shipment assumptions without enabling any automatic Purchase, Shipment, Document or lifecycle-state write.

Starting main:
`8c2737fe075f86671d70204563a2cfb612700fad`

Release candidate:
PR #151 — `agent/generic-lifecycle-review-hardening`

Temporary read-only audit:
PR #152 — closed without merge.

### V1 baseline

Generic Lifecycle V1 had already proven conservative hard-anchor linking:
- exact order number + exact merchant domain, or
- unique exact existing tracking number.

No domain+time fallback.

V1 live audit #150:
- 9,438 messages
- 43 raw generic lifecycle matches
- 7 known deterministic parser preemptions
- 36 true fallbacks
- 1 hard link
- 0 ambiguity
- 0 conflict
- 35 unmatched / REVIEW
- 14 fallback sender families
- 29 shipment + 7 invoice/receipt

The one hard link was the reviewed Sinsay shipment for an already-existing Purchase.

### Manual review findings

The 35 unmatched observations were not all simple missing-Purchase cases.

Confirmed legitimate merchant-owned lifecycle examples included Sinsay, Rossmann, Shopbuilder, AWGifts, Under Armour, Atlas For Men, R-V Webshop and other real commerce senders.

The review also exposed four important safety classes.

#### 1. Provider / relay infrastructure mistaken for merchant identity

Real transactional content may be sent by an infrastructure provider rather than the merchant.

Evidence-driven exclusions added for generic merchant identity:
- `chameleoon.sk` — observed shipment relay carrying engaro-branded fulfillment mail
- `szamlazz.hu` — invoicing/provider infrastructure
- `billingo.hu` — invoicing/provider infrastructure
- `myshoprenter.hu` — documented shared Shoprenter fallback/platform infrastructure

These channels may still become useful through dedicated provider/platform logic, but generic lifecycle must not call them the webshop.

#### 2. XLS Futár was an unknown carrier sender

Real mailbox messages from `xlsfutar.hu` were recipient parcel notifications. Because XLS was absent from the sender-role registry, V1 could let generic merchant lifecycle treat the carrier domain like a webshop.

`sender-role.ts` now registers:
`XLS Futár -> xlsfutar.hu`

This is sender-role safety only. It does not add an XLS lifecycle parser, protocol production profile or automatic shipment write.

#### 3. Known merchant fallback bypass

A generic unknown-merchant lane must never override a known merchant parser.

Exact known merchant senders are now rejected from generic lifecycle via `identifyMerchantSender(...)`. If a Dorko/GymBeam/Alza/etc. dedicated parser declines a message, a looser generic parser cannot reinterpret that same sender.

This also explains why the fresh audit has zero `existingParserPreemptions`: known merchant senders no longer enter generic lifecycle in the first place.

#### 4. Bare order-level “úton van” can describe a digital purchase

A real Bódi Tesók VIP event-ticket email had a subject equivalent to `A rendelésed úton van`, a valid order identity and event/ticket details, but no parcel, courier, tracking or physical shipment lifecycle.

V1 could classify it as `IN_TRANSIT`.

v1.1 splits physical language:
- package-level `csomagod úton van` / `package is on its way` remains strong;
- order-level `rendelésed úton van` / `order is on its way` additionally requires physical fulfillment context such as package, courier, shipment, parcel, tracking or consignment evidence.

Generic words such as `szállítás` alone do not count as physical proof.

### Parser and test changes

Parser fingerprint:
`generic-lifecycle-v1.1`

Permanent changed runtime/test files:
- `apps/api/src/ingestion/generic-lifecycle-adapter.ts`
- `apps/api/src/ingestion/generic-lifecycle-adapter.test.ts`
- `apps/api/src/email/sender-role.ts`
- `apps/api/src/email/carrier-domain-safety.test.ts`

Regression tests cover:
- Shopbuilder physical shipment positive
- Rossmann package in-transit positive
- Sinsay explicit shipped positive
- order-level in-transit + independent physical context positive
- Bódi digital-ticket hard negative
- Chameleoon relay hard negative
- Számlázz.hu provider hard negative
- Billingo provider hard negative
- MyShoprenter shared infrastructure hard negative
- known-merchant generic fallback bypass hard negative
- XLS Futár carrier role and lookalike rejection

Exact runtime PR #151 head before documentation:
`19126ad0d15a6787d19ca5cb87512adb8cba431a`

CI #629:
- **710/710 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

### Temporary PR #152 — v1.1 live read-only audit

PR #152 was created from the exact v1.1 runtime candidate, added only a temporary audit script/workflow, and was closed **without merge** after evidence capture.

Safety:
- 0 `source_emails` writes
- 0 `purchase_sources` writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production-registry activation
- no raw email/subject/message/sender/domain/order/tracking/invoice values in CI output
- 0 full-message fetch failures
- 0 rate-limit retries

Scope:
- **9,442 messages**
- 473 pages
- not truncated
- 19 existing Purchases
- 16 existing Shipments

Fresh v1.1 result:
- raw generic candidates: **22**
- known-parser preemptions: **0**
- true fallbacks: **22**
- exact order+domain hard links: **1**
- tracking hard links: **0**
- ambiguous: **0**
- conflicts: **0**
- unmatched / REVIEW: **21**
- distinct fallback families: **11**
- shipment: **16**
- invoice/receipt: **6**
- shipped: **9**
- in transit: **6**
- ready for pickup: **1**

### V1 -> v1.1 aggregate delta

The rolling mailbox grew by 4 messages between audits (9,438 -> 9,442), so this is not claimed as a perfect paired-message experiment.

Despite that growth:
- raw candidates: **43 -> 22**
- fallbacks: **36 -> 22**
- hard links: **1 -> 1**
- ambiguity: **0 -> 0**
- conflicts: **0 -> 0**
- unmatched REVIEW: **35 -> 21**
- fallback families: **14 -> 11**
- shipment candidates: **29 -> 16**
- invoice/receipt: **7 -> 6**
- in transit: **16 -> 6**
- shipped: **12 -> 9**

The proven Sinsay hard link survived while review noise and unsafe semantic classes decreased substantially.

The audit run also passed **710/710 API tests** and all API/mobile builds.

### Documentation

Detailed evidence:
`protocols/GENERIC-LIFECYCLE-V11-REVIEW-HARDENING-2026-08-17.md`

### Remaining safety state

v1.1 still does not authorize:
- Purchase creation from lifecycle-only mail
- automatic Purchase state mutation
- automatic Shipment creation/state mutation
- automatic Document creation/invoice attachment
- domain+time guessing
- known-merchant semantic override
- production protocol activation

Generic lifecycle remains REVIEW/link-only. The automatic write gate still permanently rejects parser identities matching `generic-lifecycle-v...`.

### Final release gate

Before merging PR #151:
1. run documentation-triggered CI on the exact final PR head;
2. verify PR file scope has no audit script/workflow, migration or registry activation;
3. merge with expected exact head SHA only after green CI;
4. require exact main CI and exact Render Webhook Smoke for merge SHA;
5. verify production protocol registry remains empty.

### After release

Remaining live set: **21 unmatched observations / 11 sender families**.

Next evidence task: manually cluster those 11 families, add only narrow evidence-backed rules, keep state mutation disabled, and require a separate zero-wrong-link / zero-unsafe-promotion study before any stronger automation proposal.
