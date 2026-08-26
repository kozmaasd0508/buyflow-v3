# Phase E — 100 real lifecycle V6 deterministic baseline result

Date: 2026-08-26
Mode: private read-only Gmail/Nylas shadow audit
Source protocol: `PHASE-E-100-LIFECYCLE-V6-SOURCE-EXPANSION-FREEZE-2026-08-26.md`
CI run: #1069

## Frozen source result

- source unique additions: 1065 / 130 / 119 / 2
- combined candidate messages: 1316
- qualifying root candidates: 263
- roots examined: 158
- isolated roots skipped: 58
- selected multi-message journeys: **100**

## Frozen deterministic baseline

- journeys: **100**
- discovered messages: **340**
- overlap messages: 5
- journeys with >=3 messages: 66
- journeys with >=4 messages: 30
- max messages in one journey: 15

### Automatic actions

- CREATE_PURCHASE: **26**
- automatic hard LINK_EVENT: **13**
- blocked: **301**
- journeys with an automatic Purchase: 26
- journeys with at least one automatic lifecycle link: 12

### Safety

- wrong automatic cross-journey links: **0**
- duplicate automatic Purchase creates: **0**
- automatic creates on explicit non-acceptance: **0**
- production writes: **0**
- AI calls: **0**
- unsafe findings: **none**

### Decision counts

- none: 171
- UNLINKED: 82
- NEW_PURCHASE: 26
- REVIEW: 37
- PENDING: 8
- LINKED: 16

### Canonical event counts

- none: 171
- order_created: 72
- shipment_created: 77
- invoice_created: 14
- delivered: 5
- cancelled: 1

### Promotion reason counts

- NO_CANONICAL_EVENT: 171
- DECISION_UNLINKED: 82
- ELIGIBLE_NEW_PURCHASE: 26
- ELIGIBLE_HARD_LINK: 13
- DECISION_REVIEW: 37
- HARD_CONFLICT_PRESENT: 8
- ATTACHED_TRACKING_SCOPE_UNPROVEN: 1
- ATTACHED_INVOICE_SCOPE_UNPROVEN: 2

## Regression gate

API tests: **1242/1242 PASS** before the private audit. API build, mobile typecheck and mobile build also completed successfully in the same CI run.

## Interpretation

This is the immutable deterministic baseline for the frozen 100 real multi-message lifecycle journeys. It demonstrates zero observed unsafe automatic links on this population, but intentionally conservative coverage: only 26/100 journeys received an automatic Purchase and 12/100 received at least one automatic lifecycle link.

No engine change may rewrite or replace this baseline result. Any Luna / Sol / hybrid shadow comparison must use the same frozen V6 selection and the same deterministic Identity Graph / promotion-readiness authority.
