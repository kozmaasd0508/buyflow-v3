# Second blind holdout — FIRST SCORE

Date: 2026-08-25
Frozen recognition/correlation snapshot: `8e4945a9c698fe214dcf1c67c9d8b135df5f3e87`
Mode: read-only Gmail holdout inspection + deterministic code-path verification
Production writes: 0
BuyFlow AI calls: 0

> Candidate message identifiers and user mail content are intentionally not committed. This file stores only aggregate, non-identifying results. The score is immutable and must not be rewritten after fixes.

## Headline

Fresh candidate selection was performed without opening message contents before the code snapshot was frozen. Previously used subject/date windows were excluded for the scored sample.

Four useful unknown-merchant lifecycle situations were found:

| Case | Ground truth | Frozen v2 result | Safety |
|---|---|---|---|
| A | accepted order -> later shipment, same merchant sender namespace + exact order id | automatic create + exact link | PASS |
| B | accepted order -> later shipment, sender identity not strong enough for merchant authority | no Purchase anchor | SAFE MISS |
| C | accepted merchant order -> provider-issued invoice containing the order id | Purchase anchor; provider document not auto-linked | SAFE MISS |
| D | acknowledgement explicitly says it is not the order confirmation -> later shipment | first acknowledgement can be authorized as NEW_PURCHASE because this disclaimer wording is not covered | SAFETY FAIL |

### First score

- useful unknown-merchant lifecycle cases: **4**
- safe complete automatic E2E: **1 / 4**
- safe misses: **2 / 4**
- unsafe Purchase creation: **1 / 4**
- wrong cross-merchant link observed: **0**
- unsafe cross-merchant merge observed: **0**

## Safety failure

The Purchase Creation Authority v1 non-acceptance grammar covers several contract/order-not-accepted formulations, but misses a generic Hungarian acknowledgement pattern equivalent to:

- this email is not the order confirmation,
- it only informs the buyer that the purchase offer has arrived,
- the actual confirmation will arrive in a later email.

The same message still contains strong order-created wording, a hard order id and rich commerce structure, so without the negative semantic gate it can receive `purchaseCreationAuthority=authorized` and become `NEW_PURCHASE` too early.

## Decision

The blind gate is **NOT PASSED** on this frozen snapshot because safe automatic creation requires zero known unsafe anchors.

Next change must be generic and safety-only:

1. expand Purchase Creation Authority non-acceptance semantics for explicit non-confirmation / offer-received acknowledgements,
2. add synthetic regression controls without merchant-specific names or ids,
3. keep later explicit acceptance eligible for Purchase creation,
4. rerun CI,
5. validate on a new, unopened holdout subset; never rescore this first result.
