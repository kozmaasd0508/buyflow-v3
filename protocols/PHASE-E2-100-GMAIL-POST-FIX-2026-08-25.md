# Phase E2 — 100-message fresh Gmail blind — POST-FIX SCORE

The original first score remains immutable. This document records the result after one generic, post-score structure fix.

## Frozen selection
- 100 real Gmail messages from June 2026.
- 70 from Gmail `category:purchases`.
- 30 outside Gmail `category:purchases`.
- Exact selection was frozen before message bodies were read.
- Raw Gmail identifiers, subjects, addresses, transaction identifiers and message content are not stored here.

## Generic post-score fix
The purchase-creation authority now recognizes generic Hungarian order-detail headings such as `Rendelés részlete`, `Rendelés részletei` and `Megrendelés részletei` as one commerce-structure signal.

This is not merchant-specific. The heading alone is still insufficient. Automatic Purchase creation still requires:
- `order_created` event,
- hard order identity,
- merchant source authority,
- no explicit non-acceptance/contract disclaimer,
- at least one additional independent commerce-structure signal.

## Exact live post-fix run
- CI run: #1033
- Exact code head: `d06c6841b7eef323f923f81200818ad01944678e`
- API typecheck: PASS
- API tests: 1236/1236 PASS
- API build: PASS
- Mobile typecheck: PASS
- Mobile web build: PASS
- Full-message fetch failures: 0
- Missing bodies: 0
- Missing headers: 0
- Production writes: 0
- AI calls: 0

## Post-fix score
- Messages: 100
- Promotion-eligible automatic decisions: 2
- `CREATE_PURCHASE`: 1
- `LINK_EVENT`: 1
- `UNLINKED`: 15
- No canonical event: 83
- Unsafe automatic promotions observed: 0
- 30/30 non-Purchases control messages remained non-promoted.

## Private ground-truth verification
Both automatic decisions were manually verified against the private Gmail source after the score:
1. The `CREATE_PURCHASE` case is a real merchant order confirmation with a stable order identity and rich order structure.
2. The `LINK_EVENT` case is a later shipment/handoff email from the same merchant for the exact same order identity.

Therefore the observed automatic-promotion precision on this frozen holdout is 2/2 correct, with 0 observed unsafe automatic promotions.

## Remaining recall
This does not claim full recall. Many messages remain intentionally unlinked or unrecognized. At least one rich order-shaped message in the frozen set remains a separate extraction recall gap and is not widened here. The safety gate is not relaxed to chase that miss.

## Gate interpretation
Phase E2 demonstrates a positive automatic path on real frozen Gmail data while preserving fail-closed behavior. This remains shadow/read-only evidence only; it does not enable production writes.
