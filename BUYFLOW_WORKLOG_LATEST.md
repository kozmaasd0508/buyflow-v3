# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous detailed entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-17 — Unknown Merchant generic order v1.4 safety hardening

### Goal

Make the generic/unknown-merchant order-confirmation layer safer using the exact false-positive classes found by the live v1.3 mailbox audit, without enabling automatic Purchase writes or changing the intentionally empty production protocol registry.

### Starting point

Main before this release: `9bb89dcfa35b56b63a9ba4867110a51b62a4803e`.

The v1.3 read-only two-year audit had reviewed 9,437 messages and found:
- 12 raw generic candidates
- 9 unprofiled candidates
- 7 unprofiled sender families
- 2 strong unprofiled candidates

Manual review identified four unsafe/duplicate observations:
- two structurally rich automatic acknowledgements that explicitly denied contract formation/merchant acceptance,
- one ABOUT YOU order acknowledgement with positive confirmation wording but explicit purchase-offer non-acceptance,
- one later Vitál-Kolor merchant reply that quoted the full historical order confirmation and therefore re-triggered generic `ORDER_CREATED`.

### PR #147 — v1.4 implementation

Branch: `agent/generic-order-v14-safety-hardening`.

`generic-order-confirmation-v1.4` adds:

1. **Explicit contract/offer non-acceptance guard**
   - blocks narrow Hungarian and English wording that says the acknowledgement does not form a contract, does not accept the order/purchase offer, or merely confirms receipt;
   - positive confirmation wording elsewhere does not override explicit non-acceptance;
   - known merchant-specific adapters remain separate; reviewed JatekBolt semantics still run before the generic hard-negative lane.

2. **Quoted-history guard**
   - generic new-order evidence uses only fresh message content above recognized reply/forward history;
   - handles `On ... wrote:`, Hungarian `... ezt írta:`, Original Message/Eredeti üzenet, forwarded separators, Outlook From/To/Subject blocks and `>` quoting;
   - full email content remains available to other merchant/lifecycle parsers;
   - a true fresh order above an older quoted thread remains parseable.

Regression coverage was added for Tok-shop-, Mulan-, ABOUT YOU-style disclaimers and Gmail/Outlook/forward quote shapes.

First PR CI exposed only one stale test expectation still naming v1.3; no semantic failure. After fixing it, permanent PR CI #609 passed:
- **680/680 API tests**
- API typecheck/build PASS
- mobile typecheck/build PASS

### PR #148 — one-off live v1.4 audit

Temporary draft audit PR #148 was based on the exact v1.4 release candidate and ran the rolling two-year Nylas audit read-only. It was intentionally closed **without merge** after evidence capture.

Scope:
- **9,438 messages**
- 472 pages
- not truncated
- 0 database writes
- 0 production-registry use
- 0 automatic Purchase writes
- 0 full-message fetch failures
- 0 rate-limit retries

Before v1.4 -> after v1.4:
- raw generic: **12 -> 8**
- unprofiled: **9 -> 5**
- distinct unprofiled families: **7 -> 4**
- strong unprofiled: **2 -> 0**
- repeated unprofiled families: **2 -> 1**

Privacy-safe deterministic fingerprints proved exact retention/removal:
- Manna: 2 -> 2 retained
- Scitec: 1 -> 1 retained
- Zákány: 1 -> 1 retained
- Vitál-Kolor: 2 -> 1; original retained, quoted `Re:` duplicate removed
- ABOUT YOU reviewed non-acceptance fingerprint removed
- both reviewed unsafe strong fingerprints removed

This is the desired precision improvement: all four reviewed unsafe/duplicate observations disappeared while all five reviewed legitimate order-received/recorded observations survived.

The audit run also passed **680/680 tests** and all API/mobile builds.

### Safety state

- generic parser identities remain shadow/review-only at the write gate;
- `would_write=false` for generic production-shadow diagnostics;
- no production protocol profile was activated;
- no Purchase/Shipment/Payment/Invoice/Return/Refund/Warranty write was added;
- temporary audit PR #148 was closed without merge.

### Next action after release

Merge PR #147 only after its final documentation-triggered CI is green, then require exact main-push CI and exact Render Webhook Smoke for the merge SHA. After release, keep generic order detection shadow-only and expand unseen merchant/template/language coverage before designing generic lifecycle matching to an already-known Purchase.
