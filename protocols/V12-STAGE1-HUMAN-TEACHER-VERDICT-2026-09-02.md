# BuyFlow V12 — Stage 1 Human Teacher Verdict

Date: 2026-09-02

## Scope

Manual independent review of the 14-row `teacher-review-queue.jsonl` produced by V12 Stage 1 student mining.

The reviewer judged the email semantics first, then compared the result with the seed label and student prediction. This was a local/manual review; no OpenAI API teacher call was used.

All rows are synthetic/deidentified. No frozen evaluation row is included.

## Verdict

- reviewed: 14/14
- seed labels approved: 14/14
- agreement audits: 12/12 student correct
- student disagreements: 2/2 student wrong, seed correct
- unsafe teacher disagreement: 0

Student errors:

1. `V12C1-0002`
   - family: `order_processing_vs_packing`
   - correct: `ORDER_PROCESSING`
   - student: `ORDER_PACKING`
   - reason: subject claims packing, but the current body explicitly says processing and that packing has not started.

2. `V12C1-0018`
   - family: `order_processing_vs_packing`
   - language: French
   - correct: `ORDER_PROCESSING`
   - student: `ORDER_PACKING`
   - reason: same failure pattern in another language; current body evidence explicitly negates packing even though the subject claims packing.

## Teacher rule extracted

For lifecycle semantic classification, a stale/misleading subject or snippet must not override explicit current-state evidence in the body. Explicit negation of the next lifecycle step is strong boundary evidence.

Canonical example rule:

`subject says PACKING + body says PROCESSING and "packing has not started" => ORDER_PROCESSING`

The reverse direction must also be robust:

`subject says PROCESSING + body explicitly says PACKING is now in progress => ORDER_PACKING`

## Training policy

Do not simply duplicate the two disagreement rows. Generate new synthetic sibling examples with:
- new wording and IDs;
- multiple languages;
- stale/misleading subject and snippet variants;
- HTML/plain-text placement changes;
- quoted historical-state noise;
- harmless metadata/order changes;
- balanced `ORDER_PROCESSING` and `ORDER_PACKING` targets.

The 14 reviewed rows are provenance/evidence. The next corpus should use new sibling rows rather than copying these exact documents.

Frozen Fresh Blind v1, Input View Holdout v2, frozen108 and BLIND50 remain evaluation-only and must not enter training.