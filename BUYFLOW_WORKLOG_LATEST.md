# BuyFlow V3 — latest recovery worklog

> Newest detailed entry. Read after `BUYFLOW_HANDOFF.md`. Previous detailed entries remain in Git history and `BUYFLOW_WORKLOG.md`.

## 2026-08-17 — Generic Lifecycle v1.3 multi-observation shadow

### Goal

Allow one unknown-merchant transactional email to preserve multiple independent lifecycle facts, especially shipment + invoice, without creating a second source email and without adding any automatic write authority.

Starting released main:
`73fe594d281df31307547585f6204f34d92a4039`

Permanent release candidate:
PR #156 — `agent/generic-lifecycle-multi-observation-v13`

Temporary audit:
PR #157 — closed without merge.

### Real mailbox motivation

Manual Gmail review found real combined communications where one email independently contains both logistics and document evidence.

Reviewed patterns:
- Irodamarket — exact order + DPD handoff + tracking + invoice attachment wording
- R-V Webshop — electronic invoice + exact order + courier handoff
- eDuna — formal Hungarian exact order + courier handoff + attached completed invoice

The old single-result generic lifecycle adapter could preserve only one semantic event from those messages.

### v1.3 parser design

Parser fingerprint:
`generic-lifecycle-v1.3`

New API:
`parseGenericLifecycleObservations()`

It returns independent REVIEW observations from one email.

Backward-compatible API:
`parseGenericLifecycleEmail()`

It returns the first observation only. Invoice stays first for combined invoice+shipment messages so old top-level behavior remains stable.

One email still corresponds to one `source_emails` row. Multiple facts are carried in nested fields:
- `generic_lifecycle_observations`
- `generic_lifecycle_observation_count`
- `generic_lifecycle_multi_observation`

Each nested observation remains REVIEW/link-only with explicit no-write flags.

### Identity/linking boundary unchanged

The linker still accepts only:
1. exact order number + exact merchant domain, or
2. unique exact existing tracking identity.

No domain+time fallback was added.

One hard-link decision is made for the source email using available hard identities from the observation set.

### Real Hungarian grammar learned

The real messages exposed previously missing but safe order/handoff forms:
- `14107 számú rendelésed`
- `89445 számú rendelését`
- `rendelésed átadtuk a ... futárszolgálatnak`

These were added narrowly. The hard order identity requirement for invoice observations was not relaxed.

### Future/prerequisite protection preserved

v1.2 future-state guards remain active.

A current shipment can coexist with explanatory future text, but wording such as:
`A számlát e-mailben küldjük, amikor ...`
does not create an invoice observation by itself.

The prior Oázis and Klarstein false promotions remain blocked.

### Persistence bug found before merge

During review of the multi-observation preprocessor, the first implementation reused the first validated observation as the top-level validated result and then attached the observation list to it.

Because the list contained the same first object, this would create a circular JSON reference and could break Supabase persistence.

Fixed before release with:
`buildGenericLifecycleValidatedEnvelope()`

The top-level envelope is now a separate object.

Dedicated regressions prove:
- multi-observation envelope JSON serialization succeeds
- single-observation envelope JSON serialization succeeds
- empty observation set is rejected

### Permanent CI proof

Exact permanent runtime head before documentation:
`0b949bd5a0a9e1cd61740ac6cad8b4d0e1a24874`

CI #655:
- **723/723 API tests PASS**
- 0 fail
- API typecheck/build PASS
- mobile typecheck/build PASS

New regressions include:
- real Irodamarket invoice + shipped pair
- real R-V invoice + shipment pair
- real eDuna formal-Hungarian pair
- legacy single-result compatibility
- single shipment remains one observation
- future invoice explanation does not become a second observation
- JSON-safe multi-observation persistence envelope

### Final live read-only audit — PR #157

Exact audit run:
CI #657

The audit branch contained only temporary audit code/workflow in addition to synchronized candidate runtime code and was closed **without merge**.

Safety:
- Nylas read only
- Supabase Purchase/Shipment SELECT only
- 0 database writes
- 0 source-email writes
- 0 purchase-source writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production-registry activation
- no raw email identity or purchase identifiers in CI output

Scope:
- **9,450 messages**
- 473 pages
- not truncated
- 9,449 list-body messages
- 1 full-message fetch
- 0 full-message fetch failures
- 29 provider retries
- 19 existing Purchases + 16 Shipments loaded read-only

Final result:
- source emails: **24**
- semantic observations: **25**
- one-observation sources: **23**
- two-observation sources: **1**
- live multi-observation sources: **1**
- exact order+domain hard links: **1**
- tracking hard links: **0**
- ambiguous: **0**
- conflicts: **0**
- unmatched / REVIEW source emails: **23**

Observation mix:
- shipment: **18**
- invoice/receipt: **7**

Shipment phases:
- shipped: **13**
- in transit: **5**
- ready for pickup: **0**

The single multi-observation live source had privacy-safe shape:
`invoice_or_receipt:none + shipment:shipped`
with both order and tracking identities. It matches the reviewed real Irodamarket combined email.

The previously proven exact Sinsay hard link remained one. Oázis/Klarstein future-state false positives did not reappear.

### Interpretation

The mailbox grew by one message compared with the v1.2 audit, so source count changes are not a perfect paired experiment.

v1.2:
- 20 sources
- 20 observations conceptually under single-event behavior

v1.3:
- 24 sources
- 25 observations

The source increase is controlled and comes from intentionally added real Hungarian order/handoff forms. Multi-observation itself added exactly one extra semantic observation over the source count.

No ambiguity, conflict, or new automatic write authority appeared.

### Documentation

Detailed evidence:
`protocols/GENERIC-LIFECYCLE-V13-MULTI-OBSERVATION-2026-08-17.md`

### Current release gate

Before merging PR #156:
1. exact final documentation-head CI must pass;
2. permanent PR scope must contain no audit script/workflow, migration or production registry activation;
3. merge only with exact expected head SHA;
4. verify exact main CI with 723/723 tests;
5. verify production registry remains empty;
6. verify exact Render Webhook Smoke for the merge SHA.

### After v1.3 release

Do not continue shaving legitimate generic REVIEW counts without a real safety reason.

Next high-value domain: payment evidence and safe Purchase linking.

Payment-only mail must never create a Purchase. Payment provider identity must not become merchant identity, and external provider references must not be promoted into BuyFlow order IDs without explicit merchant-side evidence.
