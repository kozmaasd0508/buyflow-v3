# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous latest entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-16 — Protocol / Merchant Library Foundation

### Goal

Create a versioned, source-auditable knowledge layer in front of the existing deterministic classifier without rebuilding BuyFlow, enabling AI, or changing existing Purchase/lifecycle/resolution safety.

### PR #99 — `Add Protocol Library foundation`

Branch: `agent/protocol-library-foundation-v1`.

Added runtime foundation under `apps/api/src/protocols/`:
- `types.ts` — common protocol/evidence contract
- `detect.ts` — source-specific evidence detector
- `registry.ts` — deliberately empty Foundation V1 registry
- `safety.ts` — provenance eligibility and authority precedence
- `profile-validator.ts` — version/source/regex/confidence validation
- `index.ts` — stable library exports
- `protocol-library.test.ts` — safety regressions

Added knowledge-base structure:
- `/protocols/schema`
- `/protocols/commerce`
- `/protocols/merchants/hu`
- `/protocols/carriers`
- `/protocols/payments`
- `/protocols/invoicing`

### Contract / safety

Profiles can emit candidate evidence for all current BuyFlow lifecycle families, including order, payment, fulfillment, delivery, cancellation, invoice, return, refund and warranty.

Every result preserves:
- protocol id/version/kind
- event candidate
- confidence
- order/tracking/invoice/payment-reference identifiers
- matched positive rules
- matched negative rules
- `blocked_by_negative_evidence`
- explicit prohibitions
- provenance levels
- `production_eligible`

Provenance levels:
- observed real email
- official documentation
- verified template
- community example
- inferred
- unknown

`inferred`/`unknown` alone can never become production-eligible. Production evidence threshold is 0.85, but eligibility never bypasses existing classifier/resolution/write gates.

Formal evidence authority was added:
- direct carrier > merchant wording for logistics
- direct payment provider > merchant wording for payment
- invoice provider/PDF > merchant invoice wording

This is precedence of evidence only; it never performs entity linking.

Protocol sender matching uses exact domain or true subdomain suffix, rejecting attacker lookalikes.

Profile validation requires semantic versioning, source-backed rules, valid/length-bounded event and identifier regexes, and confidence in range.

### Useful CI failures before merge

First PR CI #485 failed TypeScript because an identifier-pattern helper lost its type through `Object.entries()`. Fixed with explicit typed arrays; no safety semantics changed.

Second PR CI #486 passed typecheck but one new protocol test failed: the sample order-ID regex was too broad and extracted part of `visszaigazol...` from the subject instead of `HU-12345`. The example rule was tightened to explicit `Rendelésszám:` plus a digit-bearing identifier. The detector was not loosened.

Final PR CI #487 was fully green: API typecheck/tests/build and mobile typecheck/build all passed.

### Merge / deploy

Merged runtime main:
`70b90b4cc227a018ce4f56afdd2319e6f002f6eb`

- main CI #488: green
- exact Render Webhook Smoke #382: green for the exact runtime commit

Foundation V1 registers **zero production profiles**, so current BuyFlow recognition behavior remains unchanged and no new production email/Purchase/Shipment/Document data was written.

### Next

Start primary-source WooCommerce research and create the first versioned commerce profile in `research`/`test` status. Do not promote it to production until positive and hard-negative fixtures pass and the permanent 100-email benchmark shows no safety regression.

### Previous benchmark baseline

PR #97 permanent 100-email benchmark remains the safety baseline:
- 70 purchase/lifecycle fixtures + 30 noise
- 30/30 noise excluded
- 0 wrong order/tracking identities
- 0 unsafe lifecycle promotions
- new generic purchase-related recognition 9/70

The Protocol Library should improve coverage incrementally while preserving false Purchase=0 and wrong auto-link=0.
