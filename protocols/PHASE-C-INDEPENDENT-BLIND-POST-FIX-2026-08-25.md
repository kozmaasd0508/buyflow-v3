# Phase C Independent Blind — Post-Fix Result — 2026-08-25

## Frozen first score

The immutable first score remains in `PHASE-C-INDEPENDENT-BLIND-FIRST-SCORE-2026-08-25.md`:

- 7 fixtures
- 4/7 PASS
- 3/7 safe miss
- 0 wrong automatic relation
- 0 negative-control false positives

The fixture set and expectations were not changed after that score.

## Generic post-score fix

The relation extractor was changed only in generic labelled-layout handling:

- support common `Label: #ID` punctuation;
- pair explicit parent/child labels when either label appears first within a narrow line window;
- preserve multiple explicit parents for the same current child as a hard conflict;
- no merchant-specific names, domains, prefixes, or templates were added.

Safety remains unchanged:

- partial shipment without a second order identity does not create a child order;
- similar order numbers alone do not create a relation;
- current resolved order ID must equal the explicit child ID;
- ambiguity fails closed;
- 0 AI;
- shadow graph / productionWrites=0.

## Post-fix score

CI #1007 on code HEAD `51ab55999fdb9ebca22b577b922229ad4413315b`:

- Independent Phase C blind fixtures: 7/7 PASS
- API typecheck: PASS
- API tests: PASS
- API build: PASS
- Mobile typecheck: PASS
- Mobile web build: PASS

This post-fix result does not overwrite the original 4/7 first score.
