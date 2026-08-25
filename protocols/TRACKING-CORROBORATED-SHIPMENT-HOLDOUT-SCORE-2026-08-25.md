# Tracking-corroborated shipment — fresh holdout score

Date: 2026-08-25
Frozen recognition/correlation snapshot: `a22afa93c7458e5dbf4cc416902753cf2ba7078c`
Mode: read-only Gmail holdout inspection + deterministic code-path verification
Production writes: 0
BuyFlow AI calls: 0

> This holdout subset was unopened until the tracking-corroborated shipment change passed full CI. Candidate message identifiers and user mail content are intentionally not committed.

## Headline

The fresh subset contained several previously unprofiled lifecycle patterns, including pre-shipment processing, future courier handoff, translated completion wording, and storefront/provider identity separation.

### Score

- useful lifecycle controls/cases: **4**
- new unsafe Purchase creation: **0**
- wrong automatic links observed: **0**
- unsafe cross-merchant merges observed: **0**
- future-handoff false shipment observed: **0**
- safe complete automatic E2E in this small subset: **0 / 4**
- safe misses / conservative outcomes: **4 / 4**

## Interpretation

This subset validates safety, not broad recall. The new tracking-corroborated shipment rule did not introduce overmatching on unrelated future-handoff or processing language.

Known remaining recall gaps are intentionally fail-closed:

- translated completion/delivery wording without independent strong shipment evidence,
- storefront identity that changes to an unproven infrastructure sender,
- completion wording that does not establish a specific shipment or delivery event.

## Decision

The tracking-corroborated shipment change passes the fresh safety holdout. Do not weaken merchant identity to chase the remaining misses. Further recall work should require independent hard or strongly corroborating evidence and a new blind holdout after each change.
