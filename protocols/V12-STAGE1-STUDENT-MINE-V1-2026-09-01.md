# BuyFlow V12 — Stage 1 Student Hard-Case Mine v1

Date: 2026-09-01

## Purpose

Create a small, brand-new synthetic/deidentified hard-case pool around known lifecycle boundary families, then let the unchanged V11 student classify it with constrained output before spending teacher calls.

This is **not training** and is **not an evaluation holdout**. It is a teacher-candidate mining stage.

## Candidate set

144 new cases:
- 6 boundary families
- 6 languages: hu/en/de/pl/fr/es
- both sides of every boundary
- 2 representation variants per label/language

Families:
- ORDER_PROCESSING vs ORDER_PACKING
- SHIPMENT_CREATED vs SHIPPED
- SHIPPED vs IN_TRANSIT
- OUT_FOR_DELIVERY vs DELIVERED
- RETURN vs REFUNDED
- PAYMENT vs INVOICE

The text, merchants, identifiers and metadata are newly generated. No Fresh Blind v1 or Input View Holdout v2 row is copied into the candidate corpus.

## Student mining

The unchanged V11 adapter runs with constrained semantic decoding so malformed JSON cannot contaminate disagreement mining.

For every candidate we record:
- seed/intended label
- student prediction
- exact/disagreement
- unsafe promotion flag
- prompt tokens and latency
- boundary family/language

## Teacher queue policy

The teacher queue contains:
1. every student disagreement;
2. at least one student-agreement audit per family + target label.

This avoids sending all 144 cases to a strong teacher while still checking that the generator's intended labels and apparently-correct student answers are sane.

No external teacher API is called in this stage. The generated queue remains local under `local-data/lora-v12/teacher-candidates-v1/`.

## Safety

- no training
- no adapter mutation
- no frozen holdout read/reuse as candidate rows
- synthetic/deidentified only
- no Purchase/Identity/Gmail/DB writes
- teacher-reviewed rows remain non-trainable until an explicit approval stage

## Next gate

Run `scripts/BuyFlow-V12-STUDENT-MINE.cmd` and preserve the first `# SUMMARY`.

Then use a strong teacher only on the disagreement queue plus agreement audit sample. Teacher corrections must have provenance and explicit evidence checks before any row becomes a V12 TRAIN candidate.
