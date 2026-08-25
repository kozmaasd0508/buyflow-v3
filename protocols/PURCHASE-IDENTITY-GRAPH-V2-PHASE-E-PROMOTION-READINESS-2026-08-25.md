# Purchase Identity Graph v2 — Phase E Promotion Readiness

Date: 2026-08-25

## Purpose

Phase E adds an audit-only gate between Identity Graph v2 correlation decisions and any future controlled production-write path.

This phase does **not** enable production writes. It answers only:

> Is this already-produced v2 decision sufficiently scoped, conflict-free and explainable to be considered for a future controlled write?

## Base

- Base branch: `codex/universal-order-identity-v2`
- Base commit: `3e8ab254e975ae4a92b0eaf92d1fdc28145a5d78`
- Feature branch: `codex/purchase-identity-graph-v2-phase-e-promotion-readiness`

## Implementation

New pure evaluator:

- `apps/api/src/purchase-identity-v2/promotion-readiness.ts`
- version: `purchase-identity-promotion-readiness-v1`
- mode: `audit_only`
- `productionWrites: 0`
- no database access
- no network access
- no AI calls

The shadow orchestrator now exposes `promotionReadiness` beside the existing correlation decision and simulated graph result.

Important distinction:

- `simulatedGraphMutated = true` means the private in-memory shadow graph predicts a mutation.
- `promotionReadiness.eligible = true` means the decision additionally passed the stricter Phase E audit gate.
- A shadow mutation may therefore still be promotion-blocked.

## Eligible actions

Only two future-action classes can become eligible:

1. `CREATE_PURCHASE`
2. `LINK_EVENT`

Eligibility is descriptive only. Phase E contains no writer and grants no production-write capability.

## NEW_PURCHASE gate

A `NEW_PURCHASE` decision is eligible only when all of the following hold:

- event type is `order_created`
- hard order identity exists
- `purchaseCreationAuthority === authorized`
- source role is `merchant`
- merchant scope is proven by canonical merchant id or exact merchant sender namespace
- no explicit parent/child relation is present
- no hard extraction conflict exists
- any attached shipment/payment/invoice identity is independently namespace-scoped

Otherwise it is blocked with machine-readable reasons.

## LINKED gate

A `LINKED` decision is eligible only when:

- at least one hard evidence edge exists
- every hard edge targets the linked Purchase
- every hard edge is from the supported hard-evidence allowlist
- the hard evidence has the required namespace authority
- no hard extraction conflict exists
- no review-only decorated order-id alias is present
- any newly attached tracking/payment/invoice identity is independently namespace-scoped

Supported hard evidence:

- `ORDER_ID_EXACT`
- `TRACKING_ID_EXACT`
- `PAYMENT_REFERENCE_EXACT`
- `INVOICE_ORDER_ID_EXACT`
- `PARENT_CHILD_ORDER`

Unknown future hard-evidence types fail closed until explicitly reviewed.

## Always blocked

- `REVIEW`
- `PENDING`
- `UNLINKED`
- soft-only linking
- hard evidence targeting a different Purchase
- hard extraction conflicts
- decorated-order review alias participation
- unscoped tracking attachment
- unscoped payment attachment
- unscoped invoice attachment
- creation without explicit purchase-creation authority
- creation without proven merchant source scope

## Tests

Added deterministic unit coverage for:

- authorized merchant purchase creation -> eligible
- creation authority REVIEW -> blocked
- hard merchant-scoped order link -> eligible
- soft-only LINKED input -> blocked
- decorated review alias beside hard evidence -> blocked
- tracking hard link without carrier namespace -> blocked
- carrier-scoped tracking hard link -> eligible
- hard extraction conflict -> blocked
- REVIEW/PENDING/UNLINKED -> blocked
- otherwise hard order link with unscoped attached tracking -> blocked

## CI verification

Exact code snapshot tested before this documentation-only commit:

- commit: `38a5743b6a6c4e27567eb399ab30ebda160e166a`
- temporary CI-only PR: `#273`
- CI run: `32899580292` / run number `1018`
- API typecheck: PASS
- API tests: PASS
- API build: PASS
- Mobile typecheck: PASS
- Mobile web build: PASS
- temporary PR closed without merge

No code changed after that tested snapshot; this protocol file is documentation only.

## Safety invariants preserved

- 0 production writes
- 0 AI correlation
- precision over recall
- REVIEW/fail-closed preferred to unsafe merge
- no merchant-specific subject patches in correlation
- no broad time-window-only auto-linking
- no fuzzy merchant-only auto-merge
- every eligible decision remains machine-readable and auditable

## Phase E conclusion

Promotion readiness is now a separate safety decision from correlation. The codebase can measure which v2 results would qualify for a future controlled-write experiment without granting any write authority yet.
