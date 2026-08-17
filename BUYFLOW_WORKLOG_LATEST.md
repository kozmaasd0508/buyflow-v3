# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous detailed entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-17 — Generic Lifecycle V1 hard-anchor linking

### Goal

Allow later lifecycle emails from previously unknown merchants to attach useful evidence to an **already-existing Purchase**, while preserving the core invariant that lifecycle-only mail can never create a Purchase and generic evidence cannot automatically mutate lifecycle state.

Main before this release candidate:
`723f7ed523cb8a4cd2de82676c4cac0e992d0e2e`

Release candidate:
PR #149 — `agent/generic-lifecycle-link-v1`

### Architecture

`generic-lifecycle-v1` runs only after:
1. deterministic lifecycle parsers,
2. Limone,
3. deterministic commerce / generic new-order recognition.

It therefore cannot override known merchant/carrier semantics.

Supported V1 observations:
- explicitly shipped
- in transit
- out for delivery
- ready for pickup
- delivered
- invoice tied to an explicit order identity

Sender boundary:
- one merchant-owned sender domain required
- known carrier domains rejected
- shared platform senders rejected
- public mailbox domains rejected
- quoted reply/forward history stripped from generic lifecycle evidence

### Hard-link resolver

Automatic source attachment is permitted only when one of these resolves to exactly one existing Purchase:
- exact order number + exact merchant domain
- exact tracking number already belonging to an existing Shipment/Purchase

No domain+time fallback is allowed.

Resolver outcomes:
- one exact order+domain match => `linked_order_domain`
- one exact tracking match => `linked_tracking`
- multiple matches => `ambiguous`
- order and tracking disagree => `conflict`
- no hard anchor => `unmatched`

Ambiguous, conflicting and unmatched observations remain REVIEW.

### Independent safety barriers

Generic lifecycle V1 does not authorize state automation.

1. Source validation is forced to `review`; Purchase creation eligibility is false.
2. Safe links use `purchase_sources.relation_type = generic_lifecycle`; the existing trusted shipment/delivery DB trigger ignores this relation type.
3. The automatic write gate permanently rejects parser versions matching `generic-lifecycle-v...`, even if future code accidentally marks them validated or guardrailed.

Metadata explicitly records:
- `link_only = true`
- `would_create_purchase = false`
- `would_mutate_purchase_state = false`

No schema migration was needed.

### Real Sinsay edge case

Supabase contained an existing Sinsay Purchase:
- domain `sinsay.com`
- order `15710474710`

The mailbox contained a later real Sinsay shipment email:
`Visszaigazolás arról, hogy a 15710474710 rendelést elküldték.`

The first parser version missed the Hungarian word order where the identifier precedes `rendelést`. The parser was hardened to recognize this explicit form and formal wording such as `megrendelését elküldtük`, without introducing a weak fallback.

After this change the permanent PR CI passed:
- **703/703 API tests PASS**
- API typecheck/build PASS
- mobile typecheck/build PASS

### Temporary PR #150 — live read-only audit

PR #150 was a draft **DO NOT MERGE** audit branch and was closed without merge after evidence capture.

The audit:
- scanned the rolling two-year Nylas mailbox
- loaded existing Purchases/Shipments with SELECT only
- did not call the write linker
- logged aggregate metrics + HMAC sender-domain fingerprints only

Final scope:
- **9,438 messages**
- 472 pages
- not truncated
- 9,437 messages already had list-body content
- 1 full-message fetch
- 0 full-message fetch failures
- 0 rate-limit retries
- 19 existing Purchases loaded
- 16 existing Shipments loaded

Final funnel:
- raw generic lifecycle matches: **43**
- preempted by existing deterministic parsers: **7**
- true fallback generic lifecycle candidates: **36**
- exact order+domain linkable: **1**
- exact tracking linkable: **0**
- ambiguous: **0**
- conflicts: **0**
- unmatched/review: **35**
- distinct fallback sender fingerprints: **14**

Fallback event mix:
- shipment: **29**
- invoice/receipt: **7**

Shipment phases:
- in transit: **16**
- explicitly shipped: **12**
- ready for pickup: **1**
- invoice/no shipment phase: **7**

The audit also passed **703/703 tests** and all API/mobile builds.

This is the desired V1 safety profile: a reviewed real hard anchor becomes linkable, but no ambiguous/conflicting match is guessed and the other 35 observations remain REVIEW.

### Audit safety

During PR #150:
- 0 `source_emails` writes
- 0 `purchase_sources` writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production-registry use
- no raw email/subject/message/sender/order/tracking/invoice values in CI output

PR #150 was closed **without merge**.

### Documentation

Detailed design and evidence:
`protocols/GENERIC-LIFECYCLE-LINK-V1-2026-08-17.md`

### Next release gate

Before merging PR #149:
1. final documentation-triggered PR CI must be green on the exact head;
2. PR diff must contain no audit workflow/script, migration, or production protocol activation;
3. merge only the permanent parser/linker/runtime/tests/docs;
4. require exact main CI and exact Render Webhook Smoke for the merge SHA;
5. verify the production protocol registry remains empty.

### After release

Keep generic lifecycle state mutation disabled. The next evidence task is to review/cluster the remaining unmatched sender families and measure generic lifecycle shadow diagnostics before proposing any stronger automatic lifecycle update capability.
