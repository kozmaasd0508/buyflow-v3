# BuyFlow Extraction Engine v2

Status: design foundation, shadow-only. No production writes. No AI.

## Problem

The current deterministic ingestion path is a first-match parser chain. A provider-specific or merchant-specific parser can recognize the lifecycle event early and return a sparse extraction before generic field extraction has had a chance to contribute all available fields. Later enrichment then has to patch the missing fields. This creates repeated one-off fixes and couples event detection to field extraction.

## Goal

Build one deterministic extraction engine that works as a composition of independent evidence producers and field resolvers. Provider/merchant adapters may contribute high-confidence evidence, but they must never short-circuit the rest of the engine.

## Pipeline

1. Normalize email -> EmailDocument.
2. Collect evidence from all enabled extractors without early return.
3. Classify lifecycle event from evidence.
4. Resolve every field independently from the full evidence set.
5. Validate cross-field consistency and provenance.
6. Emit a canonical resolved event for Purchase Identity Graph v2.
7. Ambiguous/conflicting evidence -> REVIEW/null, never guessed data.

## Core rules

- Detection and field extraction are separate concerns.
- No first-parser-wins behavior.
- No merchant-specific regexes in the core resolver.
- Provider adapters are evidence sources only.
- Every resolved value carries provenance, confidence, and source kind where available.
- A field may be resolved even when another field or the event type is uncertain.
- Strong explicit labels outrank inferred values.
- Conflicting strong evidence produces REVIEW rather than silent overwrite.
- Lifecycle-only emails never create a purchase by themselves.
- 0 AI remains a hard requirement.

## Evidence model

Each extractor emits claims with:

- field
- value
- confidence
- source
- extractor id/version
- qualifiers such as explicit_label or trusted_sender

## Provider/merchant profiles

Profiles such as GLS, DPD, MPL, Express One, UNAS, Shoprenter, Billingo, etc. are permitted only to add structured evidence and trust metadata. They do not return a final extraction and cannot suppress generic extractors.

## Testing gates

1. Frozen regression fixtures: existing v1/v2 sets.
2. Fresh blind holdout for every material engine revision.
3. Noise precision gate must not regress.
4. Field accuracy reported separately by field and source category.
5. Conflict/review rate reported explicitly.
6. A consumed blind set becomes regression-only.

## Migration plan

### Phase A - Foundation
Create EvidenceClaim, EvidenceBundle, ResolvedField and resolver primitives. No runtime wiring.

### Phase B - Universal extractors
Move order/tracking/money/payment/merchant/product detection into independent extractors that all run for every normalized commerce candidate.

### Phase C - Adapter conversion
Convert provider and merchant adapters from final extraction producers to evidence emitters.

### Phase D - Event classifier
Build event type from combined evidence rather than parser ordering.

### Phase E - Resolver + validator
Resolve fields independently, attach provenance, and run cross-field validation.

### Phase F - Shadow comparison
Run old parser and v2 engine side-by-side against frozen regressions and a new fresh blind holdout.

### Phase G - Cutover
Only after v2 meets precision/recall/field gates, route CanonicalEvent generation to Extraction Engine v2.

## Acceptance criteria

- no first-match parser chain controls final extraction;
- all fields resolve from shared evidence;
- provider adapters cannot block generic extraction;
- every non-null critical field has provenance;
- ambiguous/conflicting critical values become REVIEW;
- fresh blind holdout demonstrates generalization;
- noise precision does not regress;
- AI calls remain 0.
