# BuyFlow V12 — Stage 1 OpenAI Teacher Review v1

Date: 2026-09-01

## Purpose

Review only the small teacher queue produced by V12 student hard-case mining. The queue contains every student disagreement plus a small agreement-audit sample. This stage does not train Qwen and does not make any Purchase/Identity decision.

## Student mine entering this stage

First local mine result:
- 144 new synthetic/deidentified candidates
- candidate SHA-256: `05d0ca898b2ccf5f75897d2930a500f960e29b1591a0ec1bb0c8996accae08fa`
- V11 student + constrained output: `142/144` exact vs seed
- disagreements: `2`
- unsafe: `0`
- teacher queue: `14` = 2 disagreements + 12 agreement audits
- both disagreements were in `order_processing_vs_packing`
- every other pilot boundary family scored `24/24`

The 144 candidates are training candidates, not evaluation holdouts. They are newly generated synthetic siblings and do not copy the frozen Fresh Blind/Input View Holdout rows.

## Independent-teacher contract

The teacher must NOT see the seed label or the student prediction before classifying the document. This avoids confirmation bias.

Teacher input contains only:
- case id
- boundary-family name
- language hint
- synthetic/deidentified `NormalizedEmailDocumentV1`-shaped document

Teacher output uses strict JSON schema:
- `event_type`: one of the 18 legal BuyFlow lifecycle labels
- `evidence_sufficient`: boolean
- `confidence`: HIGH / MEDIUM / LOW
- `rationale`: short evidence-based explanation, not chain-of-thought

After the independent response, the local runner compares teacher vs seed and teacher vs student.

## Approval rule

A row is only marked `teacher_approved_for_augmentation=true` when all are true:
1. teacher event matches the seed event;
2. teacher says the explicit evidence is sufficient;
3. teacher confidence is HIGH.

Anything else becomes `NEEDS_SECONDARY_REVIEW` and remains non-trainable.

Even approved rows are NOT immediately marked TRAIN. They are only approved as sources for later representation-invariance sibling generation. Final V12 TRAIN eligibility is created in a later isolated corpus-build step.

## OpenAI API usage

Implementation uses the Responses API and `gpt-5.6-sol` by default, configurable through `BUYFLOW_TEACHER_MODEL`.

Controls:
- `store=false`
- strict JSON-schema output
- default reasoning effort `high`, configurable through `BUYFLOW_TEACHER_REASONING`
- API key only from `OPENAI_API_KEY`
- key is never committed or written to result files
- checkpoint after every case and automatic resume
- response id and token usage recorded for provenance/cost audit

The OpenAI teacher receives only synthetic/deidentified cases in this stage. The runner refuses any queue row not explicitly marked both `synthetic=true` and `deidentified=true`.

## Files

- `scripts/v12-teacher-review-openai-v1.py`
- `scripts/run-v12-teacher-review-openai-v1.ps1`
- `scripts/BuyFlow-V12-TEACHER-REVIEW.cmd`

Local outputs are written beside the student-mine run:
- `teacher-reviews-openai-v1.partial.jsonl`
- `teacher-reviews-openai-v1.jsonl`
- `teacher-reviewed-queue-v1.jsonl`
- `teacher-review-openai-v1.metrics.json`

## Next gate

Run the 14-case teacher review. Preserve the first completed summary unchanged. Inspect any teacher-vs-seed conflicts before generating training data. If the two student disagreements are independently confirmed by the teacher as seed-correct, use their failure family to generate new sibling examples; never copy a frozen evaluation row.
