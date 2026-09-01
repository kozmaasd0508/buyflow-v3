# V11 Input View Holdout v2 — frozen protocol

Date: 2026-09-01
Branch: `codex/v11-input-view-holdout-v2`

## Question

Which representation lets the unchanged V11 Qwen3-8B adapter classify lifecycle emails most accurately and safely while using the fewest prompt tokens?

The three views are evaluated on the same newly generated, previously unused cases:

1. `FULL` — complete production-shaped `NormalizedEmailDocumentV1` object.
2. `SEMANTIC` — `BuyFlowSemanticEmailViewV1`: meaning-bearing fields only.
3. `MINIMAL` — `BuyFlowMinimalEmailViewV1`: sender domain, subject, body text, visible HTML text, selected structured identifiers and attachment name/type only.

## Frozen holdout

- 180 synthetic cases
- 18 lifecycle labels × 10
- languages: hu / en / de / pl / fr / es
- new seed: `20260901`
- new merchants, carriers, wording and perturbation layout
- production-shaped source document
- raw customer data: false
- train eligible: false
- fixture SHA-256: `8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352`

The SHA is hard-coded before local GPU inference. Any fixture drift aborts the run.

## Controls

The following stay identical across all three views:

- V11 adapter
- base model
- classification instruction
- decoding (`do_sample=false`)
- output schema
- event labels
- scoring
- case order

Only the input representation changes.

## Metrics

For each view record:

- exact accuracy
- macro event accuracy
- commerce accuracy
- invalid output count
- incoherent output count
- unsafe lifecycle promotions
- OTHER → commerce false positives
- critical boundary errors
- min/max/mean/total prompt tokens
- paired exact wins between every pair of views

The recommended view is chosen only among views with zero unsafe promotion, zero OTHER false-commerce and zero incoherent outputs when possible; accuracy is primary and lower invalid/token count is used as a tie-breaker.

## Safety / contamination

- No training occurs.
- Do not train on these 180 cases after scoring.
- Fresh Blind v1 rows are not reused as evaluation rows.
- frozen108 is not read.
- BLIND50 is not read.
- real Gmail holdout is not read.
- no Purchase / Identity / Gmail / database writes.
- Qwen remains semantic-only; Zero-Trust remains authoritative for identity/linking.

## Interruption safety

Each view checkpoints every completed case to disk and resumes from the partial JSONL after restart.

## Interpretation

This is the clean confirmation test for input representation. If a smaller representation matches or exceeds FULL while reducing safety errors and prompt tokens, it becomes the preferred candidate representation for V12. A later real-email holdout is still required before production adoption.
