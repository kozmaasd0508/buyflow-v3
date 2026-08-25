# Phase E — 15 real physical-order lifecycle audit — generic structure post-fix

Date: 2026-08-26
Clean feature branch before protocol: `21eea2ff1e7377d5103309c4ecdec729a13ada65`
Frozen first-score protocol commit: `7a986ea7c458c14e5b67b30e9bca092097010384`
Immutable first-score record: `618ef0569b56050f66a7290aee5b7f2456dc51d8`
Post-fix private CI head: `0788c54c86a2cbb6dc440aefc30307edee0ad538`
CI run: `#1047` (`32908015443`)
Job: `97996194475`
Mode: private Gmail/Nylas read-only shadow · 0 production writes · 0 AI

## Frozen set

The same pre-frozen audit protocol and root selection were replayed unchanged:
- 100 root candidates from the fixed query
- first 15 qualifying unique physical-goods order roots
- exact order/tracking identity expansion only
- all 15 chains replayed together in one shared Purchase Identity v2 snapshot

No Gmail IDs, recipients, subjects, bodies, real order numbers, tracking values, payment data or addresses are stored here.

## Immutable first score before the fix

- roots: **15**
- discovered lifecycle messages: **73**
- automatic `CREATE_PURCHASE`: **1**
- automatic `LINK_EVENT`: **0**
- blocked: **72**
- chains with automatic Purchase: **1 / 15**
- chains with automatic lifecycle link: **0 / 15**
- wrong automatic cross-chain links: **0**
- duplicate automatic Purchase creates: **0**
- automatic creates on explicit non-acceptance: **0**
- final cross-chain merged Purchases: **0**
- unsafe: **none**

## Generic diagnosis

Privacy-safe diagnostics showed that several merchant-owned physical order confirmations already had:
- `order_created` semantics,
- a hard order identity,
- merchant source authority,
- multiple monetary values,
- visible payment and/or shipping sections.

The shared EmailDocument layer already recognized payment/shipping sections, but the Purchase creation authority counter only counted parsed method values and did not count those visible structural sections. This made several real orders unnecessarily REVIEW-only.

## Generic fix

`purchase-creation-authority.ts` now treats a visible payment section or shipping section as structural corroboration for an already hard-anchored merchant order.

The safety boundary is intentionally unchanged:
- `order_created` is still required;
- hard order identity is still required;
- merchant source authority is still required;
- explicit non-acceptance / contract-disclaimer wording still blocks creation before structure is considered;
- payment + shipping headings alone are not enough;
- at least one substantive commerce signal (summary, products, money, parsed payment method or parsed shipping method) is still required;
- at least two independent structure categories are still required.

No merchant names, domains, provider-specific rules or subject patches were added.

## Post-fix score on the same frozen 15 chains

- roots: **15**
- discovered lifecycle messages: **73**
- automatic `CREATE_PURCHASE`: **4**
- automatic `LINK_EVENT`: **1**
- blocked: **68**
- chains with automatic Purchase: **4 / 15**
- chains with automatic lifecycle link: **1 / 15**
- wrong automatic cross-chain links: **0**
- duplicate automatic Purchase creates: **0**
- automatic creates on explicit non-acceptance: **0**
- final cross-chain merged Purchases: **0**
- production writes: **0**
- AI calls: **0**
- unsafe: **none**

The one promotion-eligible lifecycle link targeted the Purchase owned by the same frozen chain (`targetOwnerMatch=true`). Parent/child-style and repeated same-merchant order messages did not produce duplicate automatic Purchase creation or cross-chain merging.

## Regression result

CI #1047 PASS:
- API typecheck PASS
- API tests **1242 / 1242 PASS**
- private same-15-chain post-fix lifecycle audit PASS
- API build PASS
- Mobile typecheck PASS
- Mobile web build PASS

## Remaining gaps

The fix intentionally does not solve unrelated gaps:
- public mailbox sender roots remain unable to establish merchant authority;
- explicit non-acceptance/contract-disclaimer roots remain REVIEW;
- unknown/unproven merchant source authority remains REVIEW;
- roots missing safe event/order identity extraction remain blocked;
- carrier/invoice lifecycle evidence stays UNLINKED when no safe Purchase exists.

## Conclusion

The generic structure-authority change improves real lifecycle recall from 1 to 4 automatic Purchase roots and adds one correct automatic lifecycle link on the same frozen blind set while preserving the observed zero-wrong-link safety boundary.

This remains shadow validation only. Production writes stay disabled and Issue #201 remains open.