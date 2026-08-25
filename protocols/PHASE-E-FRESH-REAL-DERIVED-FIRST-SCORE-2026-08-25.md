# Phase E fresh real-derived first score — 2026-08-25

## Freeze boundary

- Stable Phase E code was already merged before source selection: `a4fc8a50f5b950287fff1ce05389a2755531883f`.
- Source candidate selection happened before Gmail message contents were inspected.
- Fixed source set: first 16 messages from the first 30 July 2026 search matches.
- No Phase E production/extraction/correlation code changed after source inspection and before this first score.
- Production writes: **0**.
- AI calls: **0**.

## Privacy transformation

The source mailbox content is not committed. The replay fixtures remove or replace:

- Gmail message ids,
- user names and email addresses,
- delivery/billing addresses,
- real order ids,
- real tracking ids,
- real payment references,
- other private message-specific identifiers.

The first replay also replaced public merchant/carrier sender identities with synthetic `.example` identities. That proved too aggressive for positive-source fidelity because authenticated/provider-scoped extraction authority depends on sender identity.

## Frozen first replay

Fixture freeze commit: `9a79125e65f14f835649a48b7087f24dcf21dd34`.
Harness head: `c7a0ad39dbc5ea1bfb22eb4911564de769acecc4`.
Temporary CI-only PR: #275.
CI run: #1020 (`32900597585`).

## Immutable first score

```text
fixtures: 16
eligibleCorrect: 0
safeMisses: 2
blockedControlsPassed: 14
unsafe: 0
```

The two predeclared positive cases were:

1. a merchant order confirmation expected to become an eligible `CREATE_PURCHASE`, and
2. a same-merchant shipment for the same order expected to become an eligible `LINK_EVENT`.

Both were held because the over-anonymized replay removed the sender/provider authority needed upstream; they produced no canonical event in this synthetic replay.

All 14 predeclared negative/edge controls remained promotion-ineligible. The payment-provider success example was recognized as `payment_completed` but remained `UNLINKED`, therefore Phase E correctly blocked promotion.

## Interpretation

This is **not** a production-promotion PASS because the positive real-source path was not faithfully exercised.

It is also **not** a safety failure:

- unsafe promotions: **0**,
- negative controls promoted: **0/14**,
- all writes remained disabled.

The result is recorded before any follow-up fidelity work. It must not be rescored or overwritten.

## Next gate

Run a second privacy-safe fidelity replay on the same frozen source set while preserving only public provider/merchant identity needed for deterministic authority. Continue replacing all private user and transactional identifiers. Do not change Phase E production code for this replay.
