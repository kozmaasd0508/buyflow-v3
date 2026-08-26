# Phase C Independent Blind — First Score — 2026-08-25

This first score is immutable. Do not rewrite it after fixes.

## Freeze

- Fixture freeze commit: `5eb1e471dabf330cff92ffefe50e7648195d0472`
- First executable score HEAD: `f197c1c1ca34a656424c81a585cdeddae2e22a7b`
- CI run: `#1005`
- Mode: independent public-documentation-derived fixtures
- Production writes: 0
- AI calls in BuyFlow motor: 0

The fixture wording was paraphrased from independent public documentation before scoring. It was not derived from BuyFlow parser rules.

## Sources

- WooCommerce Split Orders documentation: https://woocommerce.com/document/split-orders/
- WooCommerce Split/Copy/Merge Order Actions documentation: https://woocommerce.com/document/split-copy-merge-order-actions/
- AfterShip replacement-order metadata documentation: https://support.aftership.com/en/returns/articles/15390377-warranty-tags-and-notes
- Independent partial-shipment notification example: https://www.lettersandtemplates.com/letters/pdf/shipping-confirmation-email-sample/5/partial-order-shipment-notification.pdf

## Score

- Total fixtures: 7
- PASS: 4/7
- FAIL / safe miss: 3/7
- Wrong automatic relation: 0
- Negative-control false positives: 0

### PASS

1. `woo-split-created-from-original` — explicit child-first split relation recognized.
2. `aftership-replacement-for-original` — explicit replacement-for-original relation recognized.
3. `partial-shipment-no-child-order` — no child order invented from a multi-parcel shipment.
4. `similar-order-numbers-no-explicit-relation` — similar order numbers did not create a relation.

### SAFE MISS

1. `woo-original-then-split` — `Original order: X` followed by `Split order: Y` was not recognized.
2. `aftership-replacement-original-labels` — `Replacement order: Y` plus `Original order: X` label pair was not recognized.
3. `two-explicit-parents-conflict` — two explicit `Original order` labels for the same split child were not surfaced as a hard conflict. The extractor returned no relation rather than guessing, so this was a safe miss, not a wrong link.

## Decision

Do not change the frozen fixtures or expected results. Generic post-score work may add explicit label-pair recognition for:

- `Original/Parent order: X` + `Split order: Y`
- `Replacement order: Y` + `Original/Parent order: X`
- multiple explicit parents for the same current child -> hard conflict

Safety constraints remain:

- partial shipment without a second order identity must not create parent/child relation;
- similar order numbers alone must never create relation evidence;
- current resolved order ID must equal the explicit child ID;
- ambiguity must fail closed;
- no merchant-specific rules.
