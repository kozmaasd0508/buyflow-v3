# Phase E — 100 real lifecycle selection amendment V4

Date: 2026-08-26
Mode: private read-only Gmail/Nylas audit, 0 production writes, 0 AI.

## Why this amendment exists

The frozen primary source (`category:purchases`, 2023-01-01 through 2026-08-01, excluding spam/trash/promotions) produced only 61 unique merchant-scoped order roots under the privacy-safe anchor filter. The target remains exactly 100 independent order roots. The 61 result is retained as a failed selection attempt and is not re-labelled as a 100-case score.

## Frozen V4 source order

Candidates are considered in this fixed order and deduplicated by provider message id before any outcome scoring:

1. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases`
2. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:rendelés`
3. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:megrendelés`
4. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:"order"`

Each source is paginated up to its fixed cap. The first 100 unique qualifying roots in the combined source order are frozen as the benchmark population.

## Root qualification

A root must have:
- a stable explicit order identity extracted from generic order-id grammar;
- a sender domain that is not a carrier, public mailbox, or known shared commerce platform;
- no reply/forward subject prefix;
- no explicit digital-only/subscription-only context.

The V4 selector does **not** require that the anchor email itself already contain a fully recognized order-summary/payment/shipping structure. This is deliberate: selection is for benchmark discovery, not production eligibility. Production creation/linking remains governed by the unchanged Purchase Identity v2 promotion-readiness gates.

## Lifecycle expansion

For each frozen root, related messages are discovered only through exact order identities, exact tracking identities, and explicit parent/child/replacement relations. All selected chains are replayed together chronologically through the same Purchase Identity v2 shadow graph.

## Safety gates

The run hard-fails on any of the following:
- cross-chain automatic LINKED decision;
- final Purchase containing hard order identities from more than one frozen chain;
- duplicate automatic Purchase creation for one chain;
- automatic Purchase creation on explicit non-acceptance wording;
- any production write or AI call.

No Gmail ids, subjects, bodies, addresses, order numbers, tracking numbers, payment references, or recipient data may be printed or committed. Only aggregate counts and opaque hashes are allowed.

This amendment is frozen before the V4 outcome is known.