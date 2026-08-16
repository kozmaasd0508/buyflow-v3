# Shoprenter — 1.0.0-test.2

Status: `test` / shadow only.

## Change from test.1

A third real Shoprenter merchant investigation (WebArena) exposed a second verified platform delivery route for customer order confirmations.

The shadow detector now models two source-backed routes separately:

1. `*.smtp.shoprenter.hu` DKIM + return-path, observed on merchant-branded Shoprenter mail.
2. DKIM `shoprenter.hu` + `mailN.shoprenter.hu` return-path, observed on a real WebArena order confirmation.

Both routes still require the rendered Shoprenter order-confirmation structure and explicit order identity. Merchant visible From-domain or subject alone is insufficient.

## What is intentionally not generalized

Merchant-configured status labels are not mapped globally. Evidence collected from Gyerekjatekbolt, Home Automatica and WebArena shows that similar-looking merchant labels can carry different operational meaning.

The platform-level profile therefore enables only `ORDER_CREATED` in shadow. Shipping, delivery, payment and refund semantics remain merchant-specific until stronger evidence exists.

## Safety

- production registry remains unchanged
- profile status stays `test`
- no live writes
- no AI inference
- exact Shoprenter-owned domains are suffix-safe / anchored; lookalike domains must not match
