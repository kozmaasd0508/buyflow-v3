# BuyFlow Protocol / Merchant Library

This directory is the versioned, local knowledge layer for deterministic purchase-email recognition.

It does **not** replace the current BuyFlow classifier, Purchase/lifecycle separation, entity resolution, or safety gates. Protocol profiles only produce structured evidence. Existing downstream logic remains responsible for canonical decisions and writes.

## Intended pipeline

```text
Nylas
  ↓
normalization
  ↓
protocol / merchant detection
  ↓
source-specific evidence extraction
  ↓
CURRENT deterministic classifier
  ↓
purchase creation vs lifecycle
  ↓
CURRENT entity resolution
  ↓
Purchase assembly / current state
```

Production processing must never perform live web searches per email. Research is converted into reviewed, versioned local profiles with tests.

## Directory layout

```text
/protocols
  /schema
  /commerce
  /merchants
    /hu
  /carriers
  /payments
  /invoicing
```

The runtime TypeScript evidence contract lives in `apps/api/src/protocols/`.

## Evidence, not final decisions

A protocol match may say that an email is strong evidence for `ORDER_PROCESSING`, `SHIPMENT_CREATED`, `PAYMENT_FAILED`, etc. It does not itself create or link a Purchase.

Every evidence result carries:
- protocol id + semantic version
- candidate event
- confidence
- extracted identifiers
- matched rule ids
- negative evidence
- provenance levels
- explicit prohibitions
- whether the evidence is eligible to enter a production automatic decision

`production_eligible` only means the evidence may be considered by the existing deterministic decision pipeline. It never bypasses classifier, resolution, write gates, ambiguity handling, or ownership checks.

## Provenance levels

From strongest reviewed sources toward weakest:

1. `observed_real_email`
2. `official_documentation`
3. `verified_template`
4. `community_example`
5. `inferred`
6. `unknown`

`inferred` or `unknown` evidence alone is never production-eligible.

## Non-negotiable semantics

- lifecycle-only evidence cannot create a Purchase
- different explicit order ids cannot be silently merged
- merchant + amount + date is not sufficient for auto-linking
- direct carrier evidence outranks merchant wording for logistics state
- direct payment-provider evidence outranks merchant wording for payment state
- invoice provider/PDF evidence outranks a generic invoice word
- `READY_FOR_PICKUP` is not `DELIVERED`
- `SHIPMENT_CREATED` is not `SHIPPED`
- refund initiated is not `REFUNDED`
- merchant + carrier messages about the same shipment are evidence for one canonical lifecycle, not duplicate canonical events
- ambiguity => REVIEW
- unknown systems continue through the existing generic classifier

## Profile promotion

A new profile should move through:

```text
research → test → production
```

Before production promotion it should have:
- source references for every automatic rule
- at least one positive fixture
- hard-negative coverage
- stable identifier behavior
- no existing regression break
- explicit lifecycle prohibitions where needed

High-risk rules should have multiple negative fixtures, especially Purchase creation, delivered, refunded, payment success, and identity-linking evidence.

## Foundation V1

The first foundation intentionally registers **zero production profiles**. This guarantees that adding the library structure cannot change current email recognition. The first researched commerce profiles will be added separately after source review.
