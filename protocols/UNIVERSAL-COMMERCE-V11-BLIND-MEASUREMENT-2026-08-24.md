# Universal Commerce v1.1 — Blind Measurement — 2026-08-24

## Freeze

- Branch: `codex/universal-commerce-grammar-v1`
- Frozen code SHA before holdout content was opened: `3015b4097dfcaff369090bfea8de370bff199088`
- CI: #981 GREEN
- API typecheck: PASS
- API tests: PASS
- API build: PASS
- Mobile typecheck: PASS
- Mobile web build: PASS
- Runtime contract remains shadow-only / 0 production writes / 0 AI calls.

## Holdout construction

The candidate set was selected from Gmail by an ID-only search before any message content on the selected page was opened.

Generic search only; no merchant/shop name was used:

`after:2025/01/01 before:2026/01/01 has:attachment {számla invoice document bizonylat} -in:spam -in:trash`

The first 30-result page was skipped without reading message content. The second 30-result page became the frozen holdout. Raw Gmail IDs and private message contents are intentionally not committed.

## Ground-truth composition

30 emails total:

- 19 retail purchase-related emails
  - 8 genuine retail invoice emails
  - 11 order / purchase lifecycle emails
- 7 service or billing emails
- 1 proforma / payment-request style document
- 3 personal/sent document emails

Ground truth was established from the email contents after the code freeze and before any rule modification.

## v1.1 result

### Retail purchase-related semantic recognition

- Correctly recognized at least one real purchase semantic event: **18 / 19**
- Missed: **1 / 19**
- Measured semantic coverage on this holdout: **94.74%**

The single clear gap was a `ready for shipping / dispatch-ready` lifecycle message. v1.1 currently has no dedicated canonical state for that wording and correctly did not over-promote it to `SHIPPED`.

### Retail invoice subset

- Genuine retail invoice emails: **8**
- v1.1 invoice composition recognized as final/actionable invoice semantics: **8 / 8**
- Measured invoice semantic coverage on this holdout: **100%**

Observed generic forms included:

- invoice sent as PDF attachment
- invoice found in the attachment
- issued invoice attached to the email
- electronic invoice arrived
- invoice downloadable from an invoice portal/link

No merchant-specific name was required by the v1.1 invoice composition rules.

### Purchase ownership safety

Non-retail / non-Purchase cases in the holdout: **11**

- Unsafe automatic Purchase create/attach decisions observed: **0 / 11**

Service invoices can be semantically recognized as real invoices while the Ownership Gate still keeps Purchase ownership unproven. Proforma remains REVIEW. Personal/sent document mail does not gain Purchase authority.

### Current linking bottleneck

For the 8 genuine retail invoice emails:

- invoice semantics recognized: **8 / 8**
- automatically attachable to a Purchase through the Universal v1.1 Ownership Gate: **0 / 8**

This is intentional fail-closed behavior, but it exposes the next generic gap: order identity extraction is still too narrow for common real-world forms where the identifier appears before the order noun or in inflected Hungarian phrases, for example conceptually:

- `#<id> számú rendeléshez ...`
- `<id> számú rendeléshez ...`
- `Rendelésed #<id> ...`
- `megrendelés azonosítója: <id>`

The next safe improvement should therefore target the universal hard-order-identity extractor, not merchant-specific adapters and not a weaker Ownership Gate.

## Interpretation

This holdout supports the architectural direction:

1. Semantic recognition can generalize across previously unseen wording.
2. Semantic truth and Purchase ownership remain separate.
3. The fail-closed Ownership Gate prevents service invoices from mutating retail Purchases.
4. The main remaining blocker is generic hard identity extraction/correlation, not invoice meaning recognition.

Do not describe this as global 100% accuracy. The 8/8 figure applies only to the genuine retail invoice subset of this frozen 30-email holdout. The 18/19 figure applies only to purchase-related semantic recognition on this holdout.

## Measurement note

Because the connected Gmail data is private and raw message content must not be committed, this holdout score is a blinded protocol-level replay against the frozen v1.1 rule contract. Exact executable behavior remains guarded by the repository test suite and CI #981. A future private runtime evaluator may reproduce the same measurement without persisting raw Gmail content.