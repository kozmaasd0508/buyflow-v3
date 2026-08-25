# Unknown Webshop Challenge v1

**Goal:** measure whether BuyFlow's generic deterministic recognition works on real merchant emails from shops that have no merchant-specific BuyFlow adapter/rule.

**Mode:** evaluation only · 0 production write · 0 AI

## Frozen executable snapshot

The generic engine and TechnicalEvidence code are frozen before challenge message contents are inspected:

`e13ef747f8f622cf88d5c9f647c324a197569522`

This is the exact CI-green snapshot from GitHub Actions run #960 (1114/1114 API tests pass).

No recognition rule may be changed after candidate selection/content inspection and before the first V1 result is recorded.

## Selection

Mailbox-first, prediction-blind selection from historical Gmail outside the Retro-200 window.

Primary candidate window: 2024-07-01 through 2024-12-31.

Candidate IDs are selected before reading message content. After selection, messages may be read only for human ground truth and to determine whether the sender/merchant is eligible for the challenge.

## Unknown-shop eligibility

A commerce case is eligible only when:
- it is a real user purchase/order/lifecycle email;
- merchant sender/domain is not covered by a merchant-specific BuyFlow adapter/profile in the frozen snapshot;
- it is not a direct carrier/provider-only message being tested as the merchant;
- it was not used to write/tune the frozen generic rule before this challenge.

Known merchant-specific cases are excluded from the headline unknown-shop score, but may be retained separately as controls.

## What is measured

Primary:
- commerce detection precision/recall on eligible unknown-shop cases;
- false positives on selected non-commerce/noise;
- order-number extraction accuracy when explicitly present;
- amount/currency extraction accuracy when explicitly present;
- lifecycle family correctness (order / processing / shipment / delivery / invoice / payment) at a conservative family level.

The test does **not** reward recognizing a shop name from a hardcoded merchant profile.

## Safety rules

- No raw Gmail content or raw message IDs are committed to the repository.
- Repo-safe cases use salted/opaque hashes only.
- Human ground truth is independent of parser output.
- Unknown / ambiguous is preferable to a false positive.
- No AI is used in recognition.
- No DB/Purchase/Shipment writes.

## Interpretation

This is the first dedicated generalization challenge. A high score here is stronger evidence than repeatedly improving the same Retro-200 with merchant-specific adapters. A poor score means the generic engine must be improved; the missed merchant must not simply be patched by name.
