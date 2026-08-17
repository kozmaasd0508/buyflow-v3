# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous detailed entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-17 — Generic Lifecycle v1.2 future/prerequisite guard

### Goal

Use the fully mapped v1.1 REVIEW remainder to eliminate false current lifecycle states caused by future, conditional or prerequisite explanatory wording, without enabling any automatic Purchase, Shipment, Document or lifecycle-state write.

Starting released main:
`3a2b4ce07c0a065109cea2d54b146673be12d5b9`

Permanent release candidate:
PR #153 — `agent/generic-lifecycle-future-guard-v12`

Temporary audit PRs:
- #154 — first v1.2 live audit, closed without merge
- #155 — final exact-head live audit, closed without merge

### v1.1 REVIEW mapping

The privacy-safe mapping audit covered the full remaining v1.1 fallback set and linked all 21 REVIEW observations to real mailbox families without logging raw identities.

The set contained:
- 19 legitimate purchase-lifecycle observations without a safe existing Purchase anchor
- 2 false semantic promotions caused by future/prerequisite language

Legitimate classes included Sinsay shipment history, fizz marketplace invoice wrappers, Rossmann shipments and multiple real singleton merchant shipment/invoice families.

The two unsafe classes were OázisComputer future pickup guidance and Klarstein future courier-handoff FAQ text.

### Real false positive 1 — Oázis future pickup

Two separate Oázis emails on 2025-10-14 contained pickup wording that was not a current pickup state.

Procurement mail:
`További e-mailben értesítünk, amint rendelésed átvehető, vagy szállítható.`

Order-recorded summary:
`csak akkor indulj el ... miután kaptál értesítést, hogy a rendelésed átvehető.`

The second wording was discovered only after the first v1.2 live audit removed one Oázis pattern but left a same-day READY_FOR_PICKUP review row. Gmail inspection proved it was a different message containing prerequisite instructions.

Both are now hard-negative future/prerequisite state evidence.

### Real false positive 2 — Klarstein future courier handoff

A real Klarstein email explicitly said the order was currently processing. Later explanatory/FAQ text said:
`A számlát e-mailben küldjük, mikor a rendelését átadtuk a futárszolgálatnak.`

This describes a future condition, not an already-completed courier handoff.

The generic parser must not turn this into SHIPPED.

### Parser design

Parser fingerprint:
`generic-lifecycle-v1.2`

Identity extraction remains on the full fresh message.

Lifecycle-state and invoice-signal recognition use a separate current-evidence view. Narrowly recognized future/prerequisite statements are removed from that view.

Covered constructions include:
- `értesítünk ... amint/amikor/mikor ...`
- `küldjük/küldeni fogjuk ... amikor/mikor/amint ...`
- `miután ... értesítést ... átvehető`
- `csak akkor ... miután ... értesítést ... átvehető`
- English future notification/send equivalents

This is deliberately narrow. A real current-state sentence remains valid even if the same email separately explains a future lifecycle state.

Positive regression:
- `Rendelésedet átadtuk a futárszolgálatnak.` => current SHIPPED may remain
- `Értesítünk, amikor rendelésed átvehető lesz...` => future pickup instruction does not override the current shipment

### Permanent test verification

Exact permanent runtime head before documentation:
`8b38b023f6656d25b11804ea09cb5c98a474e101`

CI #640:
- **714/714 API tests PASS**
- 0 fail
- API typecheck/build PASS
- mobile typecheck/build PASS

### First v1.2 audit — PR #154

The first live audit candidate removed the Klarstein false SHIPPED but still showed one 2025-10-14 READY_FOR_PICKUP row.

Result:
- 9,446 messages
- 21 fallback candidates
- 1 exact hard link
- 20 REVIEW
- 10 families
- 0 ambiguity / 0 conflict

This audit was closed without merge. Follow-up Gmail inspection identified the second Oázis prerequisite email, which was then added as an explicit regression.

### Final v1.2 audit — PR #155

PR #155 was created from the exact final green runtime head, added only a temporary audit workflow, and was closed **without merge** after successful evidence capture.

Safety:
- 0 database writes
- 0 `source_emails` writes
- 0 `purchase_sources` writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production-registry use
- no raw email/subject/message/sender/domain/order/tracking/invoice/amount/product output

Scope:
- **9,449 messages**
- 473 pages
- not truncated
- 9,448 list-body messages
- 1 full message fetch
- 0 fetch failures
- 1 provider retry
- 19 existing Purchases + 16 Shipments loaded read-only

Final funnel:
- raw generic lifecycle: **20**
- fallback generic lifecycle: **20**
- exact order+domain hard link: **1**
- tracking hard link: **0**
- ambiguous: **0**
- conflicts: **0**
- unmatched / REVIEW: **19**
- fallback sender families: **9**

Event mix:
- shipment: **14**
- invoice/receipt: **6**

Shipment phases:
- shipped: **8**
- in transit: **6**
- ready for pickup: **0**

Acceptance criteria all passed:
- no 2025-10-14 Oázis review row remained
- no 2025-11-26 Klarstein review row remained
- the previously proven Sinsay exact hard link remained **1**
- ambiguity/conflict remained **0**

The audit also passed **714/714 tests** and all API/mobile builds.

### Interpretation of the remaining 19 REVIEW observations

Do not try to reduce this count by blindly filtering.

The remaining 19 are legitimate purchase-lifecycle observations that lack a safe existing Purchase anchor. REVIEW is therefore the correct safety outcome.

### Documentation

Detailed evidence:
`protocols/GENERIC-LIFECYCLE-V12-FUTURE-GUARD-2026-08-17.md`

### Current release gate

Before merging PR #153:
1. run CI on the exact documentation-final head;
2. verify PR scope contains only permanent runtime/tests/docs and no audit workflow/script, migration or production activation;
3. merge exact expected head only after green CI;
4. require exact main CI on merge SHA with 714/714 tests;
5. verify production protocol registry remains empty;
6. require exact Render Webhook Smoke on the merge SHA.

### After v1.2 release

Next architecture task should be Generic Lifecycle multi-observation shadow V1.

Real commerce emails can independently carry both shipment/logistics and invoice/document evidence in one message. The generic layer should eventually emit separate REVIEW/shadow observations for those facts rather than forcing one event type per email.

Keep exact hard-link rules unchanged and keep every automatic Purchase/Shipment/Document write disabled during that work.
