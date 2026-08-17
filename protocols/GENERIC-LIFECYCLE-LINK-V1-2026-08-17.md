# Generic Lifecycle Link V1 — 2026-08-17

## Purpose

`generic-lifecycle-v1` is a last-resort unknown-merchant lifecycle layer for emails that describe a later purchase event but are not handled by an existing merchant/carrier parser.

It exists to attach useful source evidence to an **already-known Purchase**. It is not a Purchase-creation engine and it is not an automatic state-mutation engine.

Supported V1 observations:
- merchant shipment / physical dispatch
- in transit
- out for delivery
- ready for pickup
- delivered
- invoice tied to an explicit order identity

## Parser precedence

The webhook path keeps existing deterministic logic first:

1. known deterministic lifecycle parser
2. Limone parser
3. deterministic commerce / generic new-order parser
4. `generic-lifecycle-v1`
5. AI-off review fallback

Therefore generic lifecycle cannot override a known reviewed merchant/carrier interpretation.

## Sender boundary

Generic lifecycle requires one merchant-owned sender domain and rejects:
- known carrier sender domains
- shared platform sender domains
- public mailbox providers

Quoted reply/forward history is stripped only for this generic evidence view, so an old lifecycle email quoted inside a later reply cannot become a fresh lifecycle observation.

## Hard-link gate

V1 permits a link to an existing Purchase only through one of two hard anchors:

1. **exact normalized order number + exact merchant domain**, resolving to exactly one Purchase; or
2. **unique exact existing tracking number**, already tied to exactly one Purchase through Shipment data.

No generic domain+time fallback is allowed in V1.

Safety outcomes:
- multiple order matches => `ambiguous`
- multiple tracking matches => `ambiguous`
- order and tracking anchors resolve to different Purchases => `conflict`
- no hard anchor => `unmatched`

Ambiguous, conflicting and unmatched observations remain REVIEW and are not attached automatically.

## Persistence boundary

A safely resolved source may be attached through:

```text
purchase_sources.relation_type = generic_lifecycle
```

The source itself remains:
- `validation_status = review`
- `eligible_for_purchase_creation = false`

The generic lifecycle metadata records:
- `link_only = true`
- `would_create_purchase = false`
- `would_mutate_purchase_state = false`

The existing trusted merchant lifecycle database trigger only acts on trusted `shipment` / `delivery` relations. `generic_lifecycle` therefore does not trigger Purchase state changes.

## Automatic write gate

Parser identities matching:

```text
generic-lifecycle-v...
```

are permanently shadow-only/untrusted in `automatic-write-gate.ts`, even if a future bug accidentally marks such evidence `validated` or `guardrailed`.

This is independent of the REVIEW status and the `generic_lifecycle` relation type, creating three separate safety barriers.

## Real Sinsay hard-anchor proof

Manual production-data review found an existing Purchase:
- merchant domain: `sinsay.com`
- order number: `15710474710`

The real mailbox also contained a later Sinsay shipment email whose subject stated that order `15710474710` had been sent. The original V1 grammar did not recognize the Hungarian word order where the identifier appears before `rendelést`.

The parser was hardened to recognize that explicit form and formal wording such as `megrendelését elküldtük`, without adding a weak domain/time fallback.

## One-off live mailbox audit — PR #150

Temporary draft PR #150 ran a read-only rolling two-year Nylas audit and was closed **without merge**.

Final scope on the Sinsay-hardened parser:
- **9,438 messages**
- 472 pages
- not truncated
- 9,437 list messages already contained body content
- 1 full-message fetch
- 0 full-message fetch failures
- 0 rate-limit retries
- 19 existing Purchases loaded read-only
- 16 existing Shipments loaded read-only

Safety during the audit:
- 0 `source_emails` writes
- 0 `purchase_sources` writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production-registry use
- no raw subject/body/message/sender/order/tracking/invoice values in CI output

Final funnel:
- raw generic lifecycle parser matches: **43**
- preempted by existing deterministic parsers: **7**
- true generic lifecycle fallback candidates: **36**
- exact order+domain hard links: **1**
- exact tracking hard links: **0**
- ambiguous: **0**
- conflicts: **0**
- unmatched / REVIEW: **35**
- distinct fallback sender fingerprints: **14**

Fallback event mix:
- shipment: **29**
- invoice/receipt: **7**

Shipment phases:
- in transit: **16**
- explicitly shipped: **12**
- ready for pickup: **1**
- invoice/no shipment phase: **7**

The result is intentionally conservative: only one real hard anchor resolved automatically, while every non-provable lifecycle observation stayed out of automatic linking.

## Verification

On the same final parser code:
- **703/703 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

## What V1 does not authorize

V1 does **not** authorize:
- creation of a Purchase from lifecycle-only mail
- automatic Purchase status mutation
- automatic Shipment creation or status mutation
- automatic Document creation
- automatic invoice attachment from generic evidence
- domain+time purchase guessing
- production protocol activation

The production protocol registry remains a separate explicit release decision.

## Next evidence gate

Before any generic lifecycle state mutation is considered:
1. manually review / cluster the remaining unmatched sender families;
2. expand unseen language/template coverage conservatively;
3. collect live shadow evidence for generic lifecycle semantics;
4. separately prove zero wrong links and zero unsafe state promotions;
5. require explicit production authorization for any stronger write capability.
