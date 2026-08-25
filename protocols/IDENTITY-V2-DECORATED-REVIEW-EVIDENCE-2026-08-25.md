# Identity v2 — decorated order REVIEW evidence

Date: 2026-08-25

Purpose: close the auditability gap found after the first post-fix blind score without increasing automatic-link authority.

Changes:

- add `ORDER_ID_DECORATED_REVIEW_ALIAS` as an explicit soft evidence type,
- emit it only when differing order-id forms resolve to the same conservative review identity inside the same exact merchant sender namespace,
- keep the relation REVIEW-only; it never becomes hard evidence,
- keep cross-merchant decorated-id discovery UNLINKED,
- test both plain -> decorated and decorated -> plain directions,
- require machine-readable REVIEW reasons.

Safety invariants:

- precision > recall,
- no automatic link from decorated aliases,
- no cross-merchant alias candidate,
- ambiguity -> REVIEW,
- 0 AI,
- shadow-only / productionWrites=0.

The earlier immutable blind score remains unchanged and must not be rescored.
