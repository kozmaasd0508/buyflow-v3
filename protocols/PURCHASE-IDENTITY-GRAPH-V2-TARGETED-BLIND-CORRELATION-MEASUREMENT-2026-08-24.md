# Purchase Identity Graph v2 — targeted blind correlation measurement — 2026-08-24

## Frozen gate

- Correlation code under test: `bcbc4a10266d3ed60b567be5b20394d67f51adb5`
- Freeze commit before opening targeted holdout: `8a8dc998ce2ebb6df4a9c07d65b12a2fff70f0f1`
- CI #991: GREEN, 1166/1166 tests PASS.
- 37 Gmail messages were frozen as opaque SHA-256 ids before content was opened.
- No correlation rule changed before this first result was recorded.

## What the holdout contained

The generic subject selection produced a mix of:

- real order confirmations,
- merchant shipment/status updates,
- retail invoices,
- marketplace shipment messages,
- service/provider invoices,
- promotional messages that merely contained order wording.

Two merchant families produced clean same-order multi-message chains suitable for directly testing the new unknown-merchant sender-namespace correlation rule:

1. Irodatechnikai Webáruház / micro-trend.hu
2. Mulan Home / mulan.hu

In both chains, the later merchant lifecycle message repeated the same exact order identifier and came from the same exact merchant-owned sender domain as the initial order acknowledgement.

## Identity-link result

Conditional on an existing Purchase anchor, the new identity rule would correctly match both later lifecycle messages:

- exact merchant sender namespace + exact normalized order id: **2/2 correct candidate links**
- wrong cross-Purchase links observed in these usable chains: **0**

No evidence in the holdout justified linking same order ids across different merchant namespaces.

## Blind safety finding — creation authority gap

Both usable initial order acknowledgements contained an explicit disclaimer equivalent to:

> automatic acknowledgement of order submission; this does not mean the contract has been formed

The existing generic order-confirmation safety path intentionally treats such acknowledgement/non-acceptance language conservatively. However, Extraction Engine v2 universal event extraction can still emit `order_created` from the positive order wording, and the new graph rule at the frozen snapshot allowed an unknown merchant `order_created` + hard order id + safe sender namespace to become `NEW_PURCHASE`.

Therefore the frozen end-to-end result is **not safe enough to promote** even though the identity matching itself is correct.

### Score

- Usable unknown-merchant multi-message chains: **2**
- Correct identity match for later lifecycle event, conditional on Purchase existing: **2/2**
- Wrong link: **0/2**
- Safe end-to-end create + later link: **0/2**, because both prerequisite Purchase creations bypassed the acknowledgement/non-acceptance safety boundary

This is a creation-authority failure, not an identity-correlation failure.

## Controls observed

The holdout also included provider/service invoices and promotional subjects containing order-related words. These do not provide a safe unknown-merchant namespace + order-created anchor and should not establish a Purchase through the new rule.

## Decision

**DO NOT promote the current unknown-merchant NEW_PURCHASE rule.**

Keep the exact sender-namespace + exact order-id rule for linking to an already authorized Purchase, but require an explicit upstream Purchase-creation authority decision before the graph may return `NEW_PURCHASE` for an unknown merchant.

Next fix must preserve:

- exact namespace matching for later events;
- same raw order id may exist under different merchants;
- public/shared/carrier domains cannot establish merchant namespace;
- acknowledgement/non-acceptance wording cannot gain Purchase creation authority merely because Extraction v2 emits `order_created`;
- ambiguity/conflict -> REVIEW/PENDING;
- 0 AI, 0 production writes.
