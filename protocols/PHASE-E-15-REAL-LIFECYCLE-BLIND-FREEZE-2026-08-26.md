# Phase E — 15 real physical-order lifecycle blind audit — freeze

Date: 2026-08-26
Mode: private Gmail/Nylas read-only shadow · 0 production writes · 0 AI

## Goal

Test whether Purchase Identity Graph v2 keeps multiple real purchase lifecycles separated while linking only hard, exact evidence. The primary acceptance boundary is **zero wrong automatic cross-order links/merges**. Safe misses and REVIEW are preferable to guessing.

## Frozen root candidate source

Candidate query is fixed before scoring:

`after:2026/01/01 before:2026/08/01 -in:spam -in:trash {subject:megrendelés subject:rendelés subject:"order confirmation" subject:"order received"}`

Read the first 100 results in provider order. Select the first 15 unique qualifying physical-goods order roots using the fixed rules below.

## Frozen root qualification

A root must have all of:
- current-message new-order/confirmation semantics;
- an explicit stable order identity;
- physical-fulfilment evidence such as a shipping method, delivery method, courier, parcel locker, home delivery or COD context.

Exclude:
- subscriptions and automatically renewing services;
- digital/software-only purchases;
- marketing/re-engagement mail;
- courier self-service/outbound logistics that is not a buyer purchase;
- status-only messages that do not establish a new order root.

Explicit non-acceptance/contract disclaimers do **not** remove a physical order from the audit. They remain intentional safety cases and must not receive unsafe automatic Purchase creation.

## Frozen lifecycle expansion

For each selected root:
1. search only by the exact explicit order identity;
2. hydrate matching messages read-only;
3. discover tracking identities only from explicit tracking/parcel labels in already-owned messages;
4. search only by those exact tracking identities;
5. additional order identities may join the same chain only when the current message contains an explicit parent/child, split or replacement relation.

No amount-only, merchant-only, product-only or time-window-only discovery is allowed.

All discovered messages from all 15 chains are deduplicated and replayed together in received-time order against one shared empty Purchase Identity v2 snapshot.

## Unsafe conditions

The score is unsafe if any of the following occurs:
- an automatic `LINKED` decision targets a Purchase owned by a different frozen chain;
- a promotion-eligible `CREATE_PURCHASE` occurs for a message with no unique frozen chain owner;
- a promotion-eligible `CREATE_PURCHASE` occurs on an explicit non-acceptance/contract-disclaimer message;
- more than one automatic Purchase is created for the same independent frozen order chain;
- a final Purchase contains order identities belonging to more than one independent frozen chain;
- any production write occurs;
- any AI call occurs.

Ambiguous messages discovered by exact evidence for more than one frozen chain must fail closed; they may not be used to prove an automatic cross-chain link.

## Privacy

The repository and CI logs must not expose Gmail IDs, recipients, raw subjects/bodies, real order numbers, tracking numbers, addresses, phone numbers, payment details or attachment contents. Only opaque case/chain hashes, public sender domains and coarse decision metadata may be logged.

## Score handling

The first score is immutable. If it exposes a gap, record it before any production-code change. Any later fix must be generic and must be rerun on this same frozen selection plus the full regression suite.
