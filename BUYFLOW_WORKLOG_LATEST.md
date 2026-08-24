# BuyFlow worklog latest

Current TechnicalEvidence branch: `codex/technical-evidence-shadow-v1`

Development PR: #256 -> `codex/mailgun-inbound-shadow-v3`

Mode: shadow/read-only, 0 production writes, 0 AI calls, no runtime/DB/Purchase Identity Graph authority.

## 2026-08-24 — Unknown Webshop Challenge v1 becomes the primary direction

### Product goal
BuyFlow must recognize purchase emails even when the merchant/webshop has never been seen before. Merchant/provider-specific adapters remain optional extra evidence, not the foundation of recognition.

### Frozen generic-engine challenge
Recognition code frozen before challenge message contents were inspected:
`e13ef747f8f622cf88d5c9f647c324a197569522`

The initial historical query accidentally included sent mail. That pool was not scored and no recognition rule was changed. Replacement inbound-only and commerce-enriched samples were frozen before reading.

Protocol:
`protocols/UNKNOWN-WEBSHOP-CHALLENGE-V1-2026-08-24.md`

First result:
`protocols/UNKNOWN-WEBSHOP-CHALLENGE-V1-MANUAL-REPLAY-2026-08-24.md`

### First Unknown Webshop result
Headline scored slice:
- 19 real commerce emails from merchants without a merchant-specific frozen deterministic parser rule
- 7 non-commerce controls

Commerce detection:
- TP 11
- FN 8
- FP 1
- TN 6
- unknown-shop recall 57.9%
- slice precision 91.7%

Lifecycle correctness on the 19 commerce cases:
- correct family 7
- commerce detected but wrong lifecycle family 4
- missed 8
- exact/conservative lifecycle correctness 36.8%

This is a manual deterministic replay against frozen rules, not production-wide accuracy and not an executable Nylas/GitHub run.

### Most important generic failures
1. product-review mail shaped like `Order #...` can become a false new order;
2. generic cancellation family missing;
3. identifier-before-order grammar incomplete;
4. rich `Sikeres megrendelés` confirmation can still be missed;
5. processing/packing can be confused with physical shipment;
6. pickup-ready semantics incomplete;
7. `szállításra kész` wording incomplete.

### Development rule from now on
Do NOT patch the missed merchant names.

Improve reusable generic families only, in this order:
1. eliminate review/survey `Order #...` false positives;
2. add generic cancellation semantics;
3. improve identifier-before-order grammar;
4. broaden order confirmation using structural corroboration;
5. separate processing/packing from physical shipment;
6. add generic ready-for-pickup;
7. broaden shipping-ready semantics conservatively.

Unknown Webshop Challenge v1 is now regression-only after the first result. After generic improvements, select a completely untouched v2 set for the next genuine generalization score.

## Previous frozen retro-200 reference
- total 200
- commerce 33
- noise 167
- after Direction Gate + Packeta R1 + MPL R1 + REGIO R1: actionable TP 17 / FP 0 / FN 16 / TN 167
- historical regression only, NOT fresh blind accuracy

### CI reference before Unknown Webshop Challenge
GitHub Actions run #960 validated exact code/test snapshot:
`e13ef747f8f622cf88d5c9f647c324a197569522`

PASS:
- API typecheck
- API tests 1114/1114
- API build
- mobile typecheck
- mobile web build

### Existing future blind v5
`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V5-2026-08-24.md`

Freeze snapshot:
`e13ef747f8f622cf88d5c9f647c324a197569522`

Cutoff:
`2026-08-24T18:23:26Z` / `2026-08-24 20:23:26 Europe/Budapest`

First post-cutoff Gmail ID-only preflight: 0 messages.
