# BuyFlow V11 — SemanticEmailView A/B v1

Date: 2026-09-01
Branch: `codex/v11-semantic-view-ab-v1`

## Purpose

Test whether Qwen3-8B V11 understands the same locked Fresh Blind emails better when the classifier receives a compact semantic projection instead of the full technical `NormalizedEmailDocumentV1` object.

This is a **diagnostic A/B test only**. It is not a new final holdout and must not be used as proof of final generalization because the Fresh Blind v1 aggregate result is already known.

## Baseline

The immutable V11 Fresh Blind v1 fixture remains unchanged:

- 180 cases
- 18 events × 10
- fixture SHA-256: `6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251`
- same saved V11 adapter required by SHA-256
- no training
- no frozen108, BLIND50 or real Gmail holdout reads

The runner reuses the first completed Fresh Blind v1 `predictions.jsonl` as the baseline rather than rerunning 180 full-document inferences.

## Semantic view

`BuyFlowSemanticEmailViewV1` retains fields useful for lifecycle semantics:

- sender
- subject
- received time
- snippet
- body text
- visible text extracted from body HTML
- structured schema payloads
- links
- attachment metadata

It omits technical/runtime bookkeeping that should not help lifecycle classification:

- provider message/thread ids
- recipient bookkeeping
- raw headers/auth bookkeeping
- folders
- rawRef
- normalizer version
- trace id

The classifier instruction is unchanged. Only the serialized email view changes.

## Measurement

Score the semantic view with the exact same strict scorer used by Fresh Blind v1 and compare pair-by-pair against the preserved baseline:

- exact accuracy
- macro event accuracy
- invalid output count
- unsafe lifecycle promotions
- OTHER -> commerce false positives
- critical boundary errors
- semantic-only correct vs baseline-only correct
- per-event paired wins/losses

## Safety / interpretation

- Do not train on these 180 cases.
- Do not alter the frozen fixture.
- A better SemanticEmailView result is only a **promising diagnostic**.
- Before adopting the representation for V12 or production inference, validate it on a newly frozen, untouched holdout.
- Qwen remains semantic-only; Zero-Trust identity/linking authority is unchanged.

## Reliability

The A/B runner writes each semantic prediction immediately to a partial JSONL file and resumes an interrupted compatible run automatically. Closing the PowerShell window therefore loses at most the currently running case, not the completed evaluation.
