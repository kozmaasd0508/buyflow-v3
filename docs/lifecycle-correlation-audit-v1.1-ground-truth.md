# Lifecycle Correlation Audit v1.1 — ground-truth cleanup

This checkpoint preserves the original v1 Gmail labels and first-run audit as immutable audit trail.

## Why v1.1 exists

The first v1 run exposed a ground-truth defect in P03: the label mixed two distinct GymBeam orders (`3010206178` and `3010228912`). Raw v1 precision/recall therefore cannot be treated as a clean engine baseline.

## v1.1 policy

- Original `BuyFlow Lifecycle Audit/v1/*` labels remain untouched.
- A separate `BuyFlow Lifecycle Audit/v1.1/*` label namespace is used.
- P01–P20 are copied as-is except P03.
- P03 is split into two purchase groups after mailbox evidence review; the extra group becomes P21.
- Noise is copied unchanged.
- The engine must remain unchanged for the first v1.1 run.
- Shadow only: 0 production writes and 0 AI calls.

## Acceptance invariants

- merge errors = 0
- noise false positives = 0
- production writes = 0
- AI calls = 0

After the clean v1.1 baseline is recorded, scoped correlation fixes can be evaluated against it.
