# BuyFlow V12 — Teacher + Robustness Foundation

Date: 2026-09-01

## Goal

Build the next semantic classifier as a BuyFlow specialist that is more accurate on hard lifecycle boundaries, invariant to harmless input-layout changes, and unable to emit malformed semantic output.

This work does **not** change Purchase/Identity authority. Qwen remains semantic-only; Zero-Trust BuyFlow logic remains authoritative for linking/creating purchases.

## Evidence entering V12

V11 Fresh Blind v1:
- exact 163/180 = 90.56%
- invalid output 7
- unsafe promotion 1
- critical boundary errors 10

Untouched Input View Holdout v2:
- FULL normalized input: 170/180 = 94.44%, invalid 6, unsafe 1, critical 4
- SEMANTIC: 169/180 = 93.89%, invalid 6, unsafe 2, critical 5
- MINIMAL: 168/180 = 93.33%, invalid 6, unsafe 2, critical 6

Causality diagnostic showed that dummy/neutral prompt additions can flip a lifecycle prediction. Therefore V12 must learn representation invariance and must not be tuned around one field or one frozen row.

## Non-negotiable isolation

The following data stays evaluation-only and must never become V12 TRAIN data:
- Fresh Blind v1 180 rows
- Input View Holdout v2 180 rows
- frozen108
- BLIND50
- any later frozen holdout

Failure **families** may guide new synthetic sibling generation, but frozen row text/values must not be copied into training.

## Stage 0 — Eliminate malformed output before retraining

V11 is a causal generative model and produced 6 invalid outputs on the untouched holdout across every input representation.

Before changing weights, test constrained decoding that permits only the 18 legal canonical outputs:

`{"is_commerce":<bool>,"event_type":<EVENT>}`

where `is_commerce === (event_type != OTHER)`.

First probe only the already-invalid FULL rows. This is diagnostic-only. If the constrained decoder produces zero malformed outputs and useful labels, later evaluate it on a newly frozen set before adoption.

Files:
- `scripts/v12_constrained_output.py`
- `scripts/v12-output-constraint-probe-v1.py`
- `scripts/run-v12-output-constraint-probe-v1.ps1`
- `scripts/BuyFlow-V12-OUTPUT-CONSTRAINT-PROBE.cmd`

## Stage 1 — Teacher-student hard-example corpus

Do not create V12 by multiplying the old templates.

Create new synthetic/deidentified examples around actual failure families, especially:
- ORDER_PROCESSING vs ORDER_PACKING
- ORDER_PACKING vs SHIPMENT_CREATED
- SHIPMENT_CREATED vs SHIPPED
- SHIPPED vs IN_TRANSIT
- IN_TRANSIT vs OUT_FOR_DELIVERY
- OUT_FOR_DELIVERY vs DELIVERED
- READY_FOR_PICKUP vs DELIVERED
- DELAYED vs DELIVERY_FAILED
- RETURN vs REFUNDED
- CANCELLED vs REFUNDED
- PAYMENT vs INVOICE
- OTHER commerce-looking traps

Teacher loop contract:
1. Generate a new synthetic sibling case from a failure-family specification.
2. Student Qwen classifies it.
3. Strong teacher independently classifies/reviews it.
4. Save disagreements and teacher corrections with provenance.
5. Validate that the teacher label matches explicit lifecycle evidence.
6. Only approved synthetic/deidentified examples become TRAIN candidates.

No raw customer email should be sent to an external teacher by default.

For an OpenAI API teacher, use the Responses API with strict JSON-schema output. The teacher model is configurable; the intended high-quality default is `gpt-5.6-sol`. API credentials must come from environment variables and must never be committed.

## Stage 2 — Representation-invariance augmentation

For each approved semantic case, produce meaning-preserving input variants that keep the same target label:
- production FULL normalized shape
- harmless field-order changes
- harmless metadata padding
- safe optional-field dropout
- subject/snippet stale-conflict variants
- visible-HTML vs body-text placement variants
- equivalent compact/full layouts

The training objective is:

`same semantic evidence + harmless representation change => same lifecycle label`

Do not add random metadata because one diagnostic row flipped. The augmentation is systematic and balanced across classes/boundaries.

## Stage 3 — V12 training

First candidate: Qwen3-8B QLoRA, semantic-only, exact legal target output.

Training rules:
- use newly approved V12 data, never frozen holdout rows;
- preserve class balance while deliberately oversampling hard boundaries;
- separate training and validation by semantic-family/source seed, not just row hash;
- keep one epoch as the initial baseline because V11/V7 history showed rapid overfitting is possible;
- save best validation checkpoint, not blindly last;
- record corpus hashes, adapter SHA, optimizer steps, GPU peak, and protected-set read/train flags.

If constrained decoding is successful, use it at evaluation/runtime to make invalid output structurally impossible. A sequence-classification head remains an alternate architecture experiment, not an automatic replacement for the working V11 causal adapter.

## Stage 4 — New untouched evaluation

After V12 training is completely frozen, create a new untouched holdout with:
- new seed and wording families
- new merchant/carrier placeholders
- multilingual coverage
- hard lifecycle boundaries
- representation perturbations not copied from training rows

Pass requirements should include:
- invalid output = 0
- unsafe promotion = 0
- OTHER -> commerce false positive = 0
- exact accuracy materially above V11 untouched baseline
- critical-boundary error rate materially below V11
- no protected-set contamination

Only after this fresh gate should frozen108/BLIND50 be considered as later evaluation gates.

## Current execution gate

Run Stage 0 `BuyFlow-V12-OUTPUT-CONSTRAINT-PROBE.cmd` first. Do not start V12 training until its result is preserved and interpreted.
