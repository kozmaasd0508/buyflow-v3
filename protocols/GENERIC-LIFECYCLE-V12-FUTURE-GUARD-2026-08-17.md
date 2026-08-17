# Generic Lifecycle v1.2 — future / prerequisite state guard

Date: 2026-08-17  
Permanent release candidate: PR #153  
Temporary audits: PR #154 and final PR #155 — both **closed without merge**

## Goal

Prevent explanatory, future or prerequisite fulfillment language from being interpreted as a lifecycle state that is true **now**.

Generic lifecycle remains a last-resort unknown-merchant REVIEW/link-only lane. This release does not add Purchase creation, Purchase/Shipment/Document state mutation, domain+time guessing or protocol production activation.

## Real reviewed false positives

### OázisComputer — procurement / future pickup notice

A real message said that procurement was still in progress and that the customer would be notified later when the order became available for pickup or shipping.

The phrase equivalent to:
`További e-mailben értesítünk, amint rendelésed átvehető...`

is future reporting, not `READY_FOR_PICKUP`.

### OázisComputer — order-recorded prerequisite

A second real message on the same day was an order-recorded summary. Its pickup guidance said, in effect:
`csak akkor indulj el ... miután kaptál értesítést, hogy a rendelésed átvehető.`

This is a prerequisite/instruction telling the customer to wait for a later pickup notification. It is not current pickup readiness.

### Klarstein — processing email / FAQ future courier handoff

A real processing email explicitly said the order was currently being processed. FAQ/explanatory text later said, in effect:
`A számlát e-mailben küldjük, mikor a rendelését átadtuk a futárszolgálatnak.`

The courier handoff occurs in the future condition; it is not evidence that the order has already been shipped.

## Parser design

Parser fingerprint:
`generic-lifecycle-v1.2`

Order and tracking identities are still extracted from the full fresh message.

Lifecycle-state and invoice-signal detection use a separate current-evidence view. Only narrowly recognized future/prerequisite reporting sentences are removed from that view.

Covered constructions include:
- `értesítünk ... amint/amikor/mikor ...`
- `küldjük/küldeni fogjuk ... amikor/mikor/amint ...`
- `miután ... értesítést ... átvehető`
- `csak akkor ... miután ... értesítést ... átvehető`
- English `we will notify/email/send ... when/once/as soon as ...`
- English `you will be notified/receive ... when/once/as soon as ...`

This is intentionally narrow. A current-state sentence remains usable even if another sentence in the same email explains a future state.

Example positive boundary:
- current: `Rendelésedet átadtuk a futárszolgálatnak.` => may remain `SHIPPED`
- separate instruction: `Értesítünk, amikor rendelésed átvehető lesz...` => does not cancel the already-explicit current shipment

## Regression coverage

Final permanent PR runtime head before documentation:
`8b38b023f6656d25b11804ea09cb5c98a474e101`

CI:
- **714/714 API tests PASS**
- API typecheck PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

New real-case regressions include:
- Oázis procurement future pickup => no generic lifecycle result
- Oázis order-recorded pickup prerequisite => no generic lifecycle result
- Klarstein processing/FAQ future courier handoff => no generic lifecycle result
- real current courier handoff plus future pickup explanation => current `SHIPPED` survives

Existing Sinsay, Rossmann, Shopbuilder and other positive boundaries remain covered.

## Final live mailbox proof — temporary PR #155

The final audit branch was created from the exact green permanent runtime head and added only audit workflow code. It was closed without merge.

Safety:
- database writes: 0
- `source_emails` writes: 0
- `purchase_sources` writes: 0
- Purchase writes: 0
- Shipment writes: 0
- Document writes: 0
- production protocol registry use: 0
- no raw email, subject, message id, sender address/domain, order id, tracking id, invoice id, amount or product values in CI output

Scope:
- **9,449 messages**
- 473 pages
- safety cap 10,000
- truncated: false
- 9,448 messages had list-body content
- 1 full-message fetch
- 0 full-message fetch failures
- 1 provider retry
- 19 existing Purchases loaded read-only
- 16 existing Shipments loaded read-only

Final candidate funnel:
- raw generic lifecycle: **20**
- deterministic preemptions: **0**
- fallback generic lifecycle: **20**
- exact order+domain hard links: **1**
- exact tracking hard links: **0**
- total hard links: **1**
- ambiguous: **0**
- conflicts: **0**
- unmatched / REVIEW: **19**
- distinct fallback sender families: **9**

Event mix:
- shipment: **14**
- invoice/receipt: **6**

Shipment phases:
- shipped: **8**
- in transit: **6**
- ready for pickup: **0**

Acceptance proof:
- no 2025-10-14 Oázis future/prerequisite pickup review row remained
- no 2025-11-26 Klarstein future FAQ shipment review row remained
- the previously proven exact Sinsay hard link remained **1**
- ambiguity and conflict remained **0**

## v1.1 -> v1.2 interpretation

The rolling mailbox changed during the work, so aggregate counts are not presented as a perfect paired-message experiment. The exact reviewed regressions are separately locked by tests.

The important safety outcome is qualitative and exact:
- two reviewed future/prerequisite lifecycle false promotions are gone
- no new ambiguity/conflict appeared
- the existing exact hard link survived
- the remaining 19 REVIEW observations are legitimate purchase-lifecycle evidence without a safe existing Purchase anchor

Those 19 are not a target to eliminate merely to reduce a metric. REVIEW is the correct result until stronger identity evidence exists.

## Remaining architecture gap

The next high-value generic lifecycle improvement is multi-observation shadow support.

Real emails can independently contain both:
- shipment/logistics evidence, and
- invoice/document evidence

in the same message.

Generic lifecycle should eventually emit separate REVIEW/shadow observations for those facts instead of forcing one event type per email. Exact hard-link rules and all existing write barriers should remain unchanged during that work.
