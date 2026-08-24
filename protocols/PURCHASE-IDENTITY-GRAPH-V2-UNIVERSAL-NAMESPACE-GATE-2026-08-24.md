# Purchase Identity Graph v2 — Universal Merchant Namespace Gate

## Goal

Safely correlate unknown-merchant lifecycle events before a canonical Merchant Identity Registry entry exists.

## Hard-link rule

An order identifier may become hard correlation evidence through either:

1. canonical merchant identity + exact normalized order id, or
2. exact safe merchant sender namespace + exact normalized order id.

A sender namespace is only eligible when the canonical event source role is `merchant` and the exact sender domain is not a public mailbox, shared commerce sender infrastructure, or a known carrier domain.

## Fail-closed rules

- same order id under a different merchant namespace is not a link;
- provider invoice sender without merchant namespace stays REVIEW;
- public mailbox / shared platform / carrier sender cannot establish merchant namespace;
- ambiguous hard candidates stay REVIEW;
- extraction conflicts stay PENDING;
- payment, tracking and invoice identities keep their existing namespace requirements;
- canonical merchant id is never invented from sender domain;
- 0 AI;
- productionWrites = 0.

## Scale case

Two unrelated merchants may both issue order `12345`. Distinct safe sender namespaces must allow two distinct Purchases rather than merging or globally reserving the raw order number.

## Validation

Run full API and mobile CI, then measure end-to-end correlation separately as LINKED / REVIEW / PENDING / UNLINKED / WRONG_LINK. A wrong link is a hard failure regardless of recall.
