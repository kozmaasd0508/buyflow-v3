# TechnicalEvidence Retro Holdout v1 — REGIO R1 delta

**Status:** HISTORICAL REGRESSION ONLY · NOT BLIND ACCURACY  
**Mode:** SHADOW · 0 PRODUCTION WRITE · 0 AI

## Frozen dataset

- total: 200
- commerce ground truth: 33
- noise ground truth: 167
- Mixed: 100
- NoiseEnriched: 100

Ground truth was frozen before this REGIO change and was not modified.

## Previous baseline after Direction Gate v1 + Packeta R1 + MPL R1

Event authority:
- TP 11
- FP 0
- FN 22
- TN 167

Actionable TechnicalEvidence:
- TP 14
- FP 0
- FN 19
- TN 167

## REGIO R1 reviewed family

Frozen sender cardinality:
- Mixed: 3 direct `regiojatek.hu` transactional messages
- NoiseEnriched: 0 direct `regiojatek.hu` messages
- 197/200 cases are excluded from this adapter by sender/domain scope.

The three affected frozen messages are one observed REGIO order lifecycle:
1. order received / recorded -> `order_created`
2. fulfillment processing started -> `order_processing`
3. products handed to carrier -> `shipment`

All three carry the same explicit `WS .../...` order identity under the REGIO merchant namespace.

Reviewed transport evidence includes:
- authenticated `regiojatek.hu` sender;
- matching DKIM pass;
- `SiteEngine(c)GreyMatter` multipart boundary;
- explicit current-message lifecycle wording;
- one unique order identity that agrees between subject and body.

## Critical negative control

A real REGIO survey/review message was reviewed from the same sender family. It contains:
- the same authenticated REGIO sender;
- the same SiteEngine boundary family;
- an explicit order number;
- previous-purchase wording.

It is still non-actionable because it has no supported current lifecycle template. Therefore sender + platform + order number alone is intentionally insufficient.

Other fail-closed tests cover:
- bad/missing authentication;
- missing SiteEngine boundary;
- mismatched/ambiguous order identity.

## Targeted frozen-200 result after REGIO R1

### Event authority

- TP **14**
- FP **0**
- FN **19**
- TN **167**
- precision **100.00%**
- recall **42.42%**
- F1 **59.57%**

### Actionable TechnicalEvidence

Actionable means an eligible lifecycle event or hard identifier after the existing safety gate.

- TP **17**
- FP **0**
- FN **16**
- TN **167**
- precision **100.00%**
- recall **51.52%**
- F1 **68.00%**

Known frozen false-positive gate remains **0**.

## CI validation

Exact REGIO code/test head:

`e13ef747f8f622cf88d5c9f647c324a197569522`

GitHub Actions CI run #960:
- API typecheck: PASS
- API tests: **1114/1114 PASS**
- API build: PASS
- mobile typecheck: PASS
- mobile web build: PASS

CI-only PR #262 was closed without merge after validation.

## Interpretation boundary

These figures are useful to compare changes on the same frozen historical 200-message set. They are not a claim of future or production accuracy. The next true unseen evidence must use a new blind freeze because REGIO R1 changed evaluation-affecting logic after Blind Holdout v4.
