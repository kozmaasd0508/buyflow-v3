# Phase E — 100 real Gmail blind — immutable first score

Date: 2026-08-26
Stable production-code base: `c312b7f591f8a1dc606d9b71af08fa30893d4ef0`
Private audit head: `f65820b79e0badfbbb7e66e1d7032a5badfc9f47`
CI run: `#1036` (`32905392533`)
Job: `97988223388`
Mode: private read-only shadow · 0 production writes · 0 AI

## Frozen population

100 unique real Gmail messages selected before reading contents:
- 60 Purchases
- 14 unique Updates after deduplication
- 26 Promotions

No Gmail IDs, subjects, bodies, recipients, purchase identifiers, tracking identifiers, payment references or other raw private values are stored in this protocol.

## First score

- cases: **100**
- promotion-eligible CREATE_PURCHASE: **0**
- promotion-eligible LINK_EVENT: **0**
- blocked: **100**
- no CanonicalEvent: **86**
- REVIEW or PENDING: **1**
- promotion-bucket violations: **0**
- production writes: **0**
- AI calls: **0**

The full repository CI also passed:
- API typecheck PASS
- API tests **1234 / 1234 PASS**
- API build PASS
- Mobile typecheck PASS
- Mobile web build PASS

## Interpretation

Safety is fail-closed on this first score: no message became automatically promotion-eligible, and no Promotions-bucket message was promoted.

This is **not** evidence of production-ready automatic precision because there were zero automatic positive decisions. Precision is therefore not meaningfully established by this run. Automatic coverage is insufficient.

A known genuine merchant order in the frozen set produced `order_created` but remained `REVIEW`; its later same-order merchant shipment stayed `UNLINKED`. This must be diagnosed without weakening the promotion gate or changing production extraction/correlation rules before diagnosis is recorded.

## Next allowed action

Only privacy-safe diagnostics may be added to the private runner first, such as:
- Purchase creation authority and reason codes
- EmailDocument structure counts
- presence/absence flags for HTML and extracted structure

No production parser, extraction, correlation, identity or promotion-readiness rule may be changed until the cause is identified.
