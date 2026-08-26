# Phase E — 100 real physical-order lifecycle learning audit — frozen protocol

Date: 2026-08-26
Mode: private Gmail/Nylas read-only shadow · 0 production writes · 0 AI

## Goal

Build a 100-order real lifecycle benchmark and use it to improve generic Purchase Identity v2 recall without relaxing the zero-wrong-link safety boundary.

This is not merchant-specific training. The frozen set is used to discover recurring generic gaps, then every proposed generic change must be replayed on the same 100 chains and the full regression suite.

## Frozen source and selection

Root source query:

`after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases`

Selection is deterministic and outcome-blind:
- scan at most the first 1200 root candidates returned by the provider;
- hydrate candidates in provider order;
- take the first 100 unique qualifying physical-goods order roots;
- qualification requires a stable explicit order identity, fresh order-received/confirmed semantics, and physical shipping/delivery structure;
- reply/forward roots and obvious digital/subscription-only orders are excluded;
- uniqueness key is exact sender-domain namespace + normalized order identity;
- no result from Purchase Identity v2 is used to decide whether a root enters the frozen set.

## Lifecycle expansion

For each frozen root:
- search only by exact observed order identity values;
- collect exact tracking identities observed in those messages;
- search only by those exact tracking values;
- explicit parent/child/replacement wording may add additional exact order identities;
- no fuzzy merchant match, amount-only search, subject similarity, or time-only expansion is allowed;
- at most 4 distinct order identities and 4 tracking identities are expanded per chain.

All discovered messages from all 100 chains are replayed together, chronologically, into one shared Purchase Identity v2 shadow snapshot.

## Safety gates

The run is unsafe if any of these occur:
- an automatic LINK_EVENT targets a Purchase owned by a different frozen chain;
- a chain gets more than one automatic CREATE_PURCHASE without an explicit safe relation;
- CREATE_PURCHASE occurs on explicit order non-acceptance / contract-disclaimer wording;
- final graph state merges exact order identities belonging to different frozen chains;
- any production write occurs;
- any AI call occurs.

Any unsafe result is a hard failure and remains part of the immutable first score.

## Privacy

Never commit or log:
- Gmail/Nylas message ids;
- recipient addresses;
- raw subjects or bodies;
- real order ids or tracking ids;
- payment references, card/payment details, postal addresses, or product-level PII.

The CI output may contain only aggregate counts and opaque hashes needed to prove chain ownership.

## Learning rule

After the immutable first score:
1. group misses by generic reason (for example missing event semantics, missing merchant authority, insufficient independent structure, missing hard identity, or safe-unlinked lifecycle);
2. fix only recurring generic causes;
3. add focused positive and negative regression tests before replay;
4. replay the exact same frozen 100 chains;
5. accept a change only if correct automatic coverage increases while wrong automatic links, duplicate creates, non-acceptance creates, and cross-chain merges all remain zero.

Merchant names, sender domains, one-off subject strings, real order ids and tracking ids must never be added to production logic as a consequence of this benchmark.

Production writes remain disabled. Issue #201 remains open.