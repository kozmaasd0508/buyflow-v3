# Phase E — 100 real lifecycle V6 source-expansion freeze

Date: 2026-08-26
Mode: private read-only Gmail/Nylas shadow audit.

## Purpose

V5 preserved the merchant-scoped lifecycle ownership rules but found only 62 qualifying multi-message journeys from the Gmail `category:purchases` source. The V5 outcome remains immutable and is not re-labelled as a 100-case score.

V6 changes **root discovery sources only**. It does not change BuyFlow extraction, Purchase Identity Graph correlation, promotion-readiness, lifecycle ownership, or production code.

## Frozen candidate source order

Candidates are considered in this exact order and deduplicated by provider message id before root qualification:

1. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases` — cap 1200
2. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:rendelés` — cap 800
3. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:megrendelés` — cap 800
4. `after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:"order"` — cap 800

The combined deduplicated candidate cap is 3600. The first 100 qualifying multi-message journeys in this frozen combined source order are selected. No root is selected or rejected based on BuyFlow output.

## Root qualification — unchanged from V5

A root must have:
- an explicit stable order identity;
- a non-carrier, non-public-mailbox, non-shared-platform sender domain;
- no reply/forward prefix;
- no explicit digital/subscription-only context.

Root identity remains exact normalized sender domain + exact normalized order identity. No fuzzy merchant matching is permitted.

## Lifecycle expansion — unchanged from V5

For each root:
1. exact order-token results can join only when the normalized sender domain exactly matches the root sender domain;
2. carrier senders cannot establish ownership through a retail order number;
3. tracking identities can be learned only from already-owned merchant messages;
4. carrier lifecycle may join only by the exact learned tracking identity;
5. explicit parent/child/replacement relations may extend order identities, still inside the same merchant scope.

A journey qualifies only when it contains at least two distinct safely-owned messages.

## Replay and hard-fail safety — unchanged from V5

All messages from the frozen 100 journeys are replayed chronologically through one Purchase Identity v2 shadow graph.

Hard fail on:
- automatic LINKED decision to a Purchase owned by another benchmark journey;
- one final Purchase containing hard order identities from different benchmark journeys without explicit relation;
- duplicate automatic Purchase creation for one benchmark journey;
- automatic Purchase creation on explicit non-acceptance;
- any production write;
- any AI call in the deterministic baseline.

Ambiguous shared ownership must fail closed / REVIEW.

## Comparison plan after successful freeze

Once exactly 100 multi-message journeys are frozen, the same population will be used for:
1. deterministic 0-AI baseline;
2. Luna shadow extraction;
3. Luna → Sol fallback shadow extraction.

All three lanes must feed the same deterministic Identity Graph / promotion-readiness authority. AI may propose extraction claims but may not directly CREATE, LINK, merge, or write Purchase state.

## Privacy

No Gmail/Nylas ids, subjects, bodies, sender addresses, order ids, tracking ids, payment references, addresses, recipients, or raw private transaction values may be logged or committed. Only aggregate counts and opaque hashes are allowed.

This V6 protocol is frozen before the V6 outcome is known.