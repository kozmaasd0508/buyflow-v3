# TechnicalEvidence Blind Holdout v1 — 2026-08-23

**Status:** CANDIDATE FREEZE ESTABLISHED BEFORE DATA SELECTION  
**Mode:** EVALUATION ONLY · 0 WRITE · 0 AI

## Freeze

TechnicalEvidence candidate-freeze commit:

`df221aa42856179c3c1b0b9e94d5d364b4ac7048`

GitHub commit timestamp / selection cutoff:

`2026-08-23T21:58:12Z` (`2026-08-23 23:58:12 Europe/Budapest`)

Only messages whose `receivedAt` is strictly after this cutoff may enter the first TechnicalEvidence Blind Holdout v1 candidate pool.

The protocol/harness may be added after this freeze, but no TechnicalEvidence extractor, provider/carrier/PDF/Shopify rule, semantic mapping, normalization rule, evidence authority rule or evaluation-affecting code may change between ground-truth freeze and the first prediction result. If such logic changes, the unseen set must be versioned forward before it may be called blind again.

## Purpose

Measure whether the multi-layer TechnicalEvidence approach generalizes to genuinely unseen email traffic rather than only to the already-reviewed development families.

This holdout is independent from the earlier Extraction Engine blind sets. It evaluates TechnicalEvidence coverage/correctness and its potential rescue value without granting production authority.

## Candidate selection

Selection is mailbox-first and parser-blind.

Do NOT run TechnicalEvidence, Extraction Engine v2, legacy extraction, Purchase Identity Graph or AI to decide which candidate emails to include.

Use only post-cutoff messages that were not inspected during TechnicalEvidence development.

Target eventual coverage where the mailbox naturally provides it:
- order confirmation / order created
- payment confirmation / payment receipt
- invoice / receipt, including PDF-backed documents
- shipment created / shipped
- out for delivery / ready for pickup
- delivered
- return / refund / cancellation
- hard non-commerce noise
- platform/security/account mail that can superficially resemble commerce
- Shopify security/login/marketing/custom-mail negatives
- ambiguous links, generic `id` / `ids` / `code` / `ref` parameters
- QR/barcode/action-code cases where available

Do not synthetically balance the set by copying old reviewed messages. Missing categories remain missing until genuinely unseen examples arrive.

## Privacy

Repository-safe material may contain only opaque/hash-like case ids, field-state ground truth and aggregate results.

Do not commit:
- Gmail/provider message ids
- subjects
- bodies
- raw MIME
- customer names/addresses
- order/tracking/invoice/payment values
- attachment filenames or raw attachment content

## Ground truth

Ground truth must be annotated from the original message before TechnicalEvidence predictions are viewed for the frozen cases.

Each scored field uses one of:
- `known`: the source proves the value
- `not_applicable`: the field should not exist for this message
- `unknown`: the source does not prove enough to judge

Suggested scored dimensions:
- commerce relevance
- event type
- platform/provider family
- merchant/storefront scope
- order number
- carrier
- tracking number
- invoice number
- payment reference
- amount
- currency
- PDF-backed document presence/type
- action/pickup code when semantically separate from tracking

A parser-produced value must never become ground truth.

## TechnicalEvidence scoring

Per field/evidence type:
- exact supported
- missing
- contradiction
- false positive
- false negative
- unsupported/unknown
- provenance/source layer

Aggregate:
- commerce-specific TechnicalEvidence coverage
- explicit event coverage
- merchant-scoped / namespaced hard-identifier coverage
- contradiction count
- unsafe identity-authority attempts
- false-positive rate on hard noise

Also measure rescue opportunities against the frozen Extraction Engine v2 output, but Extraction v2 output is never ground truth.

## Critical safety failures

Any of the following is critical:
- generic `id` / `ids` / `code` / `ref` promoted without exact provider/type context
- Shopify/CDN/platform fingerprint alone promoted to commerce lifecycle authority
- future/conditional shipment wording promoted to current shipment
- pre-advice/label creation promoted to physical shipment
- ready-for-pickup promoted to delivered
- QR/pickup code promoted to tracking identity without explicit semantic proof
- tracking-like value granted a carrier namespace without carrier proof
- contradictory hard identifiers merged instead of REVIEW/unsupported
- payment-only evidence creating purchase authority

## Anti-overfitting rule

The first blind result is permanent baseline evidence. Once predictions for a frozen case are viewed, that case is no longer blind and may only be used for regression.

No rule may be changed and then re-scored on the same set as if it were still blind.

## Cutover rule

No production cutover is allowed from development coverage alone.

Production authority requires:
1. a fresh frozen blind result;
2. explicit review of every critical mismatch/false positive;
3. zero unsafe identity-authority failures;
4. repository tests/typecheck/CI evidence on the exact candidate code;
5. a separate explicit production activation decision.
