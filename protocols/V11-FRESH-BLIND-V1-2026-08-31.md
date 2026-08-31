# BuyFlow V11 Fresh Blind v1 — frozen evaluation protocol

Date: 2026-08-31  
Branch: `codex/v11-fresh-blind-v1`  
Base: `codex/modern-email-source-foundation-v1` @ `c89f57d454d500f847b64bfa1386d738c8645d12`

## Purpose

Evaluate the completed Qwen3-8B V11 adapter on a newly authored, post-training holdout before reading the older `frozen108`, `BLIND50`, or real-Gmail holdouts.

This gate measures semantic generalization only. It does not grant Purchase/Identity authority and it performs no BuyFlow database, Gmail, or production writes.

## V11 training evidence used only to select the adapter

Expected trainer status:
`LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE`

The evaluator refuses to start unless the V11 run records all of these as false:
- `frozen_108_trained`
- `blind_50_trained`
- `locked_test_read`
- `locked_test_trained`

The evaluator does not read the old holdouts.

## Important input-shape gate

The V11 training generator described its input as `NormalizedEmailDocument/v1`, but its synthetic training object was a simplified representation (`headers`, `text`, `html_fragment`, `structured_data`, `mime_features`, etc.).

Fresh Blind v1 intentionally evaluates against the actual BuyFlow production `NormalizedEmailDocumentV1` top-level contract from `apps/api/src/email/document-v1.ts`:
- `schemaVersion`
- provider/message/thread identifiers
- subject/from/to/cc/bcc/receivedAt/snippet
- `bodyText` / `bodyHtml`
- header array / folders / attachment metadata
- `structuredData`
- `links`
- authentication verdicts
- raw reference / normalizer version / trace id

This is deliberate: the extremely low in-family V11 validation loss is not treated as proof that the adapter generalizes to the production document representation.

## Frozen fresh fixture

The fixture is generated deterministically after V11 training completed, before model inference.

- total cases: **180**
- event types: **18**
- cases per event: **10**
- languages: `hu,en,de,pl,fr,es`
- synthetic only: **true**
- raw customer data: **false**
- train eligible: **false**
- fixture SHA-256: `5a03856c3a5962860224a809eb9c4f45d28190e2618b534dfc9c4880ac0e9582`

The runner aborts if regenerated fixture bytes no longer match that hash.

## Hard families represented

The set deliberately contains stale/misleading subjects, stale snippets, HTML-only current state, structured identifier traps, marketing footers, quoted old states, future-state negatives, and non-commerce Product/Offer traps.

Critical boundaries scored separately:
- ORDER_PROCESSING ↔ ORDER_PACKING
- ORDER_PACKING ↔ SHIPMENT_CREATED
- SHIPMENT_CREATED ↔ SHIPPED
- SHIPPED ↔ IN_TRANSIT
- IN_TRANSIT ↔ OUT_FOR_DELIVERY
- OUT_FOR_DELIVERY ↔ DELIVERED
- READY_FOR_PICKUP ↔ DELIVERED
- DELAYED ↔ DELIVERY_FAILED
- RETURN ↔ REFUNDED
- PAYMENT ↔ INVOICE

## Model prompt/output contract

The evaluator uses the same V11 classification instruction as training so this gate changes the evaluation data/representation, not the task prompt.

Strict output schema:
`{"is_commerce": <boolean>, "event_type": <one of 18 labels>}`

Code fences, extra keys, malformed JSON, invented labels, or wrong types count as invalid output.

## PASS gate

All must hold:
- invalid outputs = **0**
- incoherent outputs = **0**
- unsafe lifecycle promotions = **0**
- OTHER → commerce false positives = **0**
- exact classification accuracy ≥ **90%**
- macro event accuracy ≥ **85%**

Unsafe promotions include premature physical/terminal progress such as SHIPMENT_CREATED → SHIPPED/DELIVERED, OUT_FOR_DELIVERY → DELIVERED, READY_FOR_PICKUP → DELIVERED, and RETURN → REFUNDED.

## Freeze rule

After the first scored run:
- do **not** edit this fixture to improve the score;
- do **not** train V11 on these rows;
- preserve the fixture hash and first metrics as evaluation evidence;
- analyze failure families only;
- only a later model version may train on derived corrections, with a different future holdout.

## Execution

Windows launcher:
`scripts/BuyFlow-V11-FRESH-BLIND.cmd`

PowerShell runner:
`scripts/run-v11-fresh-blind-v1.ps1`

Python evaluator:
`scripts/v11-fresh-blind-v1.py`

Local outputs (gitignored/private runtime data):
`local-data/lora-v11/fresh-blind-v1/`

The fresh blind must run before the decision to open `frozen108`, `BLIND50`, or real-Gmail holdout evaluation.
