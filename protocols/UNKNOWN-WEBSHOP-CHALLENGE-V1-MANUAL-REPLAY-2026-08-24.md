# Unknown Webshop Challenge v1 — first frozen result

**Status:** FIRST RESULT RECORDED  
**Evaluation:** manual deterministic replay against frozen code rules  
**Recognition code snapshot:** `e13ef747f8f622cf88d5c9f647c324a197569522`  
**Mode:** 0 AI · 0 production write

## Why this exists

This challenge measures the behavior of BuyFlow's generic deterministic recognition on real incoming webshop emails from merchants that do not have a merchant-specific rule in the frozen deterministic parser.

No recognition rule was changed after challenge selection/content inspection began and before this result was recorded.

## Selection correction

The first historical candidate query accidentally included sent mail. That pool was not scored and no rule was changed from it. Selection was then refined using metadata only to `-from:me` before the replacement inbound samples were opened.

The scored headline slice uses real incoming messages from the frozen commerce-enriched samples plus frozen noise controls.

Known merchant-specific parser cases, direct carrier/provider messages, the user's own shop, and known-platform-only controls are excluded from the headline unknown-shop score.

## Headline unknown-shop slice

Scored unknown-shop commerce cases: **19**  
Scored non-commerce controls: **7**

### Commerce detection

- true positive: **11**
- false negative: **8**
- noise false positive: **1**
- noise true negative: **6**

On this challenge slice:
- unknown-shop commerce recall: **57.9%** (11/19)
- precision among positive decisions in the scored slice: **91.7%** (11/12)

These are challenge-slice figures, not production-wide accuracy estimates.

### Lifecycle correctness

Of the 19 real unknown-shop commerce emails:
- correct commerce family/lifecycle: **7**
- commerce detected but lifecycle family wrong: **4**
- missed: **8**

Exact/conservative lifecycle correctness on the 19 commerce cases: **36.8%** (7/19).

## What the generic motor already does well

It can recognize several genuinely unseen merchant order confirmations without a merchant name rule when the email contains common structural evidence such as:
- explicit order confirmation wording;
- labeled order number;
- order-details structure;
- payment/shipping fields;
- product rows.

The successful slice included multiple unrelated merchants and different email layouts; they were not recognized through merchant-specific names in the frozen deterministic parser.

## Important failures found

### 1. Real false positive: product-review request

A post-purchase review email with a subject shaped like `Order #<id>, how did it go?` is likely promoted by the frozen generic strong-subject order pattern even though it is not a new order.

This is the highest-priority safety bug from the challenge.

### 2. Cancellation family missing

Generic cancellation language such as an order being explicitly cancelled is not yet a first-class generic lifecycle family, causing real unknown-shop cancellation messages to be missed.

### 3. ID-before-order grammar gap

Patterns where the identifier appears before the order noun (for example `<id> számú megrendelés ...`) are not covered consistently for shipment/cancellation recognition.

### 4. Rich successful-order wording can still be missed

A real email containing `Sikeres megrendelés`, a labeled order number, products, payment, shipping and total can still be missed if the exact confirmation wording does not match the frozen phrase set.

### 5. Processing/packing can be confused with shipment

Some generic processing/packing wording is currently classified as shipment even when the carrier handoff has not happened yet.

### 6. Pickup-ready is incomplete

Store-pickup readiness phrasing can be missed even with a stable order identity.

### 7. Shipping-ready wording is incomplete

Phrases equivalent to `szállításra kész` are not covered consistently.

## Decision

The challenge confirms two things at once:

1. BuyFlow already has real generic generalization: it recognized **11 of 19** unknown-shop commerce cases without merchant-specific rules.
2. The generic engine is **not ready yet** as a high-recall general unknown-shop motor because it missed 8/19, misclassified 4 lifecycle families, and produced one real false positive.

## Next development rule

Do **not** add merchant-name patches for the missed shops.

Improve only reusable generic families:
1. block review/survey `Order #...` false positives;
2. add generic cancellation semantics;
3. support identifier-before-order grammar;
4. broaden successful-order confirmation wording using structure, not merchant names;
5. split processing/packing from physical shipment;
6. add generic ready-for-pickup semantics;
7. broaden shipping-ready semantics conservatively.

After those changes, this V1 set becomes regression-only. A new untouched Unknown Webshop Challenge v2 must be selected for the next genuine generalization score.

## Safety / interpretation

This is a **manual deterministic replay**, not a GitHub/Nylas executable accuracy run, because private Gmail message bodies are not copied into the repository or CI. The replay follows the exact frozen code rules and records the first result before any post-challenge tuning.
