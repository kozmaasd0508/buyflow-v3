# Purchase Creation Authority v1 — 2026-08-24

## Why this gate exists

A hard order identifier answers **which order** an event refers to. It does not by itself prove that a new Purchase may be created.

The targeted blind correlation holdout exposed a boundary where a merchant email contained strong order structure and a hard order id, but also explicitly stated that the automatic acknowledgement did not mean the contract had been formed. Extraction v2 could still emit `order_created` from the positive wording.

## Rule

Unknown-merchant `NEW_PURCHASE` now requires a separate upstream creation authority:

1. canonical event is `order_created`;
2. hard order id exists;
3. source role is merchant;
4. at least two independent commerce-structure signals exist;
5. no explicit non-acceptance / contract-formation contradiction is present;
6. graph still requires a safe exact merchant sender namespace.

If the email explicitly says the order has not been accepted, the message only acknowledges receipt, or the acknowledgement does not form/constitute a contract, creation authority is `review`.

## Separation of responsibilities

- semantic/extraction layer: what happened?
- Purchase Creation Authority: may this event create a new Purchase?
- Purchase Identity Graph: which Purchase does it belong to?

The graph never upgrades a raw order id into creation authority by itself.

## Invariants

- exact namespace + exact order id remains hard linking evidence for an already authorized Purchase;
- different merchant namespace + same raw order id does not merge;
- public/shared/carrier sender cannot establish merchant namespace;
- lifecycle-only event cannot create Purchase;
- ambiguity/conflict -> REVIEW/PENDING;
- 0 AI;
- 0 production writes.
