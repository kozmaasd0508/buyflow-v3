# Generic Lifecycle v1.1 — review hardening

Date: 2026-08-17
Release candidate: PR #151 (`agent/generic-lifecycle-review-hardening`)
Baseline release: Generic Lifecycle V1 on main (`8c2737fe075f86671d70204563a2cfb612700fad`)

## Goal

Review the V1 live-audit remainder — 35 unmatched generic lifecycle observations across 14 sender families — and remove unsafe sender-role assumptions and weak physical-shipment semantics without adding any automatic Purchase, Shipment, Document, or lifecycle-state write authority.

## What manual review found

The unmatched set contained both legitimate merchant-owned lifecycle mail and unsafe generic interpretations.

Legitimate examples included merchant-owned shipment/invoice flows such as Sinsay, Rossmann, Shopbuilder, AWGifts, Under Armour, Atlas For Men, R-V Webshop and other real commerce senders. Their lack of a hard link often meant only that the corresponding Purchase was not already present in BuyFlow.

Safety gaps found during review:

1. **Third-party shipment relay is not merchant identity.**
   A real engaro-branded shipment notification arrived through `chameleoon.sk`. The relay can carry useful lifecycle evidence but must not become the merchant identity in the generic lane.

2. **Invoice-provider infrastructure is not merchant identity.**
   Számlázz.hu and Billingo are provider channels. Merchant-branded content sent through those providers does not make the provider domain the webshop.

3. **Shared Shoprenter infrastructure is not merchant identity.**
   The documented `myshoprenter.hu` fallback remains platform evidence only.

4. **Unknown carrier infrastructure must not be interpreted as a merchant.**
   Real `xlsfutar.hu` recipient notifications showed that XLS Futár is a carrier channel. The sender-role registry now classifies it as carrier infrastructure so the generic merchant lifecycle lane cannot claim it.

5. **Known merchants cannot bypass their dedicated parser through a looser generic fallback.**
   If a sender is already an exact known merchant, its dedicated deterministic parser remains the semantic authority. A rejection there must not be overturned by generic lifecycle grammar.

6. **Bare order-level “on the way” wording does not prove a physical parcel.**
   A real Bódi Tesók VIP event-ticket email used `rendelésed úton van` even though it described a digital/event purchase with no parcel, courier, tracking, or physical fulfillment lifecycle. Generic order-level in-transit wording therefore needs independent physical-fulfillment evidence.

## Parser changes

Parser version:

`generic-lifecycle-v1` -> `generic-lifecycle-v1.1`

### Non-merchant infrastructure gate

Generic merchant identity now rejects evidence-driven infrastructure domains including:
- `chameleoon.sk`
- `szamlazz.hu`
- `billingo.hu`
- `myshoprenter.hu`

Public mailbox, shared platform and known carrier exclusions remain in place.

### Known-merchant authority gate

Exact senders already registered as known merchants are rejected from the generic lifecycle lane. Dedicated merchant parsers remain the only semantic authority for those senders.

### XLS Futár sender role

`xlsfutar.hu` is now classified as carrier infrastructure in the sender-role registry. This does **not** add an XLS lifecycle parser, protocol production profile, or automatic logistics write.

### Physical context for order-level in-transit wording

Package-level phrases such as `csomagod úton van` remain strong physical-lifecycle evidence when a hard purchase identity is present.

Order-level phrases such as `rendelésed úton van` or `your order is on its way` now require an additional physical-fulfillment signal such as package, courier, shipment, parcel, tracking, consignment or equivalent context.

The generic lane deliberately does not treat generic commercial words such as `szállítás` alone as proof of a physical parcel.

## Regression coverage

The permanent test suite covers:
- real-style Shopbuilder physical dispatch
- real-style Rossmann package in transit
- real Sinsay Hungarian shipment grammar
- order-level in-transit with independent physical context
- Bódi Tesók digital-ticket false-shipment hard negative
- Chameleoon relay hard negative
- Számlázz.hu provider hard negative
- Billingo provider hard negative
- MyShoprenter shared infrastructure hard negative
- known-merchant generic-fallback bypass hard negative
- XLS Futár carrier sender-role safety and lookalike rejection

Exact PR #151 runtime head before documentation passed:
- **710/710 API tests**
- API typecheck/build PASS
- mobile typecheck/build PASS

## One-off live audit — PR #152

Temporary PR #152 ran the exact v1.1 parser candidate against the rolling two-year Nylas mailbox. It was read-only and closed **without merge** after evidence capture.

### Scope

- **9,442 messages**
- 473 pages
- not truncated
- 9,441 list messages already contained body content
- 1 full-message fetch
- 0 full-message fetch failures
- 0 rate-limit retries
- 19 existing Purchases loaded read-only
- 16 existing Shipments loaded read-only

### V1 -> v1.1 aggregate delta

The mailbox grew from 9,438 to 9,442 messages between runs, so this is an aggregate live comparison rather than a perfect paired-message experiment.

- raw generic lifecycle candidates: **43 -> 22**
- existing-parser preemptions: **7 -> 0**
- true generic lifecycle fallbacks: **36 -> 22**
- exact hard links: **1 -> 1**
- ambiguous: **0 -> 0**
- conflicts: **0 -> 0**
- unmatched / REVIEW: **35 -> 21**
- distinct fallback sender families: **14 -> 11**
- shipment candidates: **29 -> 16**
- invoice/receipt candidates: **7 -> 6**
- in-transit phase: **16 -> 6**
- shipped phase: **12 -> 9**
- ready-for-pickup: **1 -> 1**

The seven old known-parser preemptions disappeared because known merchant senders no longer enter the generic parser in the first place.

Most importantly, the single previously proven Sinsay hard link remained linkable while no ambiguity or conflict was introduced.

## Audit safety

PR #152 performed:
- 0 `source_emails` writes
- 0 `purchase_sources` writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production-registry activation

CI output contained no raw email, subject, message ID, sender address/domain, order ID, tracking ID or invoice ID.

## What v1.1 still does not authorize

v1.1 does **not** authorize:
- Purchase creation from lifecycle-only mail
- automatic Purchase state mutation
- automatic Shipment creation or state mutation
- automatic Document creation or invoice attachment
- domain+time purchase guessing
- known-merchant semantic override
- production protocol activation

Generic lifecycle remains REVIEW/link-only and parser identities matching `generic-lifecycle-v...` remain permanently untrusted at the automatic write gate.

## Next evidence gate

The remaining live set is now **21 unmatched observations across 11 sender families**. Next work should:
1. manually cluster/review those remaining families;
2. separate legitimate merchant templates from residual infrastructure/noise;
3. add narrow sender-role or semantic rules only when backed by direct evidence;
4. keep generic lifecycle state mutation disabled;
5. require a separate zero-wrong-link / zero-unsafe-promotion study before any stronger automatic write capability is proposed.