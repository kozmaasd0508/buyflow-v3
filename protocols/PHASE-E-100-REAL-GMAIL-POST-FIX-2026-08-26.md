# Phase E — 100 real Gmail post-fix audit

Date: 2026-08-26
Stable base before fix: `c312b7f591f8a1dc606d9b71af08fa30893d4ef0`
Clean generic fix head: `dd691c29e52d576d6535862ffb5b7a47d82b4823`
Private CI-only audit head: `48df07186a4f2ca0999020538d7d73076624df16`
CI run: `#1040` (`32906093226`)
Job: `97990421263`
Mode: private read-only shadow · 0 production writes · 0 AI

## Frozen set

Same 100 private Gmail messages frozen before the first score:
- 60 Purchases
- 14 unique Updates
- 26 Promotions

No Gmail IDs, subjects, bodies, recipients or transaction identifiers are stored in this protocol.

## First score before fix

- automatic CREATE_PURCHASE: 0
- automatic LINK_EVENT: 0
- blocked: 100
- Promotions-bucket automatic promotions: 0
- unsafe: 0

The first score was safe but too conservative. Privacy-safe diagnostics showed that a genuine Hungarian merchant order already had a hard order identity, merchant source authority and order-created semantics, but its visible Hungarian `Rendelés/Vásárlás részletei` block was not recognized as the same generic order-summary structure already supported for English `Order details`.

## Generic fix

The shared `EmailDocumentV1` section detector now recognizes normalized Hungarian order-detail headings:
- `Rendelés részlete / részletei`
- `Rendelési részlete / részletei`
- `Vásárlás részlete / részletei`

No merchant name, sender domain or merchant-specific subject/body rule was added.

Purchase creation remains gated by the existing independent requirements including hard order identity, merchant source authority, independent commerce structure and no explicit non-acceptance conflict.

## Post-fix score on the same frozen 100 messages

- cases: **100**
- correct automatic CREATE_PURCHASE: **1**
- correct automatic LINK_EVENT: **1**
- blocked: **98**
- Promotions-bucket automatic promotions: **0**
- unsafe automatic promotions observed: **0**
- production writes: **0**
- AI calls: **0**

The two automatic decisions are the same genuine merchant order lifecycle: the order confirmation creates one Purchase and the later same-order merchant shipment links to that Purchase through the exact hard order identity. No unrelated or promotional message was promoted.

## Regression result

CI #1040 PASS:
- API typecheck PASS
- API tests **1237 / 1237 PASS**
- private 100-message Gmail post-fix audit PASS
- API build PASS
- Mobile typecheck PASS
- Mobile web build PASS

## Conclusion

The generic Hungarian order-structure fix improves recall on the frozen real-Gmail set without reducing the observed automatic precision boundary. This remains shadow validation only; it does not enable production writes.
