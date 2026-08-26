# Phase E — 100 real lifecycle V5 scoped journey freeze

Date: 2026-08-26
Mode: private read-only Gmail/Nylas shadow audit, 0 production writes, 0 AI.

## Why V5 exists

The immutable V4 first score remains preserved. Privacy-safe diagnostics showed that V4 benchmark expansion assigned messages to multiple benchmark chains when the same normalized order number appeared under different sender domains. This happened because the benchmark discovery query searched a bare exact order token across the mailbox and treated every result as belonging to every root with that token.

That is not valid ground truth. An order number without merchant scope is not globally unique, and Purchase Identity v2 itself intentionally does not treat it as globally unique.

V5 changes **benchmark discovery/ownership only**. It does not change extraction, correlation, promotion-readiness, or production code.

## Frozen V5 population rule

Primary candidate source remains fixed:

`after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases`

Candidates are processed in provider order. A root candidate must have:
- an explicit stable order identity;
- a non-carrier, non-public-mailbox, non-shared-platform sender domain;
- no reply/forward prefix;
- no explicit digital/subscription-only context.

Root identity is benchmark-scoped by exact normalized sender domain + exact normalized order identity. No fuzzy merchant matching is used by the benchmark.

## Scoped lifecycle discovery

For each root candidate:

1. Search the exact order token inside the frozen date window.
2. An order-token result belongs to that benchmark journey only when its normalized sender domain is exactly the root sender domain. A different merchant sender cannot join merely because it uses the same order number.
3. Exact order-token results from carrier senders do not establish ownership.
4. Tracking identities may be learned only from messages already safely owned by the root journey.
5. A tracking-token result may join the journey only when it contains the exact same normalized tracking identity. Carrier lifecycle is therefore bridged by exact tracking, not by bare retail order number.
6. Explicit parent/child/replacement relations may expand order identities, but the same merchant-scope rule remains in force for order-token ownership.

## What counts as one lifecycle journey

A root qualifies for the V5 benchmark only if scoped discovery produces at least **two distinct messages** for that root. This ensures the requested benchmark is 100 actual multi-message order journeys rather than 100 isolated order roots.

The first 100 qualifying multi-message journeys are frozen. No journey is selected or rejected based on BuyFlow's output or whether BuyFlow later succeeds on it.

## Replay and safety

All messages belonging to the 100 frozen journeys are replayed chronologically through one Purchase Identity v2 shadow graph.

Hard-fail safety conditions:
- automatic LINKED decision to a Purchase owned by a different benchmark journey;
- one final Purchase containing hard order identities from different benchmark journeys without explicit relation;
- duplicate automatic Purchase creation for one journey;
- automatic create on explicit non-acceptance;
- any production write or AI call.

Ambiguous shared tracking ownership must fail closed / REVIEW rather than be arbitrarily assigned.

## Privacy

No Gmail/Nylas ids, subjects, bodies, sender addresses, order ids, tracking ids, payment references, addresses, recipients, or other private transaction values may be logged or committed. Output is aggregate counts and opaque hashes only.

This protocol is frozen before the V5 outcome is known.