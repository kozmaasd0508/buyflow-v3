# Phase E — 100 real physical-order lifecycle learning — selection v2 freeze

Date: 2026-08-26
Mode: private Gmail/Nylas read-only shadow · 0 production writes · 0 AI

This protocol supersedes only the root-selection rule from Attempt 1. It does not change Purchase Identity v2 extraction, correlation, promotion-readiness, or write safety.

## Source

Root source query:
`after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases`

Scan at most the first 1200 candidates returned by the provider.

## Chain-anchor selection

A candidate may anchor a frozen lifecycle chain when all are true:
- it contains at least one explicit stable order identity from audit-only exact identifier extraction;
- it is not a reply/forward root;
- it is not obvious subscription/digital-only commerce;
- it contains physical-commerce structure: at least one shipping/delivery section or physical fulfillment term, OR a substantive order structure with money/product evidence and a physical delivery term;
- the exact key `sender-domain namespace + normalized order identity` has not already been selected.

The candidate does **not** need to be an `order_created` message. It is only a discovery anchor. Whether any message can actually create a Purchase remains entirely controlled by the normal v2 creation-authority and promotion-readiness gates.

## Exact lifecycle expansion

For each selected anchor:
- search only exact observed order identity values;
- collect exact tracking identities observed in returned messages;
- search only exact observed tracking values;
- explicit parent/child/replacement wording may add exact related order identities;
- no fuzzy merchant matching, amount-only matching, time-only matching, or subject similarity may expand a chain;
- maximum 4 distinct order identity searches and 4 distinct tracking searches per chain.

All 100 frozen chains are replayed chronologically into one shared Purchase Identity v2 shadow snapshot.

## Safety gates

Hard failure if any occur:
- automatic LINK_EVENT targets a Purchase owned by a different frozen chain;
- duplicate automatic Purchase creation inside one chain without safe explicit relation;
- CREATE_PURCHASE on explicit non-acceptance/contract-disclaimer wording;
- final graph merges exact order identities owned by different frozen chains;
- any production write;
- any AI call.

## Privacy

Never commit or log raw Gmail/Nylas message ids, recipients, raw subjects/bodies, real order/tracking/payment identifiers, addresses, or product-level personal information. Report aggregate counts and opaque hashes only.

## Learning gate

The first successful 100-chain score is immutable. After it is recorded, recurring misses may be grouped by generic cause. Production changes are allowed only when they are merchant/provider independent, receive positive and negative regression tests, improve the same frozen 100-chain replay, and preserve zero unsafe automatic correlation.