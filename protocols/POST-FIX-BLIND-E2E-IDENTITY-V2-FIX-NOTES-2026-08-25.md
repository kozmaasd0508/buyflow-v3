# Post-fix Blind E2E Identity v2 — fix notes

The immutable first score is stored separately and is not rescored.

Post-score changes are generic only:

- universal event extractor v7 recognizes successful order-recorded wording,
- universal event extractor v7 recognizes completed `carrier/courier service -> handed over` wording while preserving future-handoff as non-shipment,
- generic cancelled-status wording is recognized,
- short alphabetic decoration around an order id may discover a candidate only inside the same exact merchant sender namespace,
- decorated-id discovery is REVIEW-only and cannot become a hard automatic link,
- no merchant-specific names or prefixes were added.

Safety invariants remain:

- precision > recall,
- ambiguity -> REVIEW,
- no cross-merchant decorated-id candidate,
- 0 AI,
- shadow-only / productionWrites=0.
