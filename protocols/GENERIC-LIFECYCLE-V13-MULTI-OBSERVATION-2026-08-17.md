# Generic Lifecycle v1.3 — multi-observation shadow

Date: 2026-08-17  
Permanent PR: #156  
Temporary live audit: PR #157 — **closed without merge**

## Goal

Allow one unknown-merchant transactional email to preserve multiple independent lifecycle facts without increasing automatic write authority.

A real email may independently prove both:
- shipment/logistics progress, and
- invoice/document existence.

Before v1.3 the generic lifecycle adapter returned only one event, so the second fact was lost.

## Safety boundary

Generic lifecycle remains REVIEW/link-only.

v1.3 does **not** authorize:
- Purchase creation
- Purchase lifecycle state mutation
- Shipment creation or state mutation
- Document creation or invoice attachment
- domain+time matching
- known-merchant override
- production protocol activation

`automatic-write-gate.ts` continues to reject every parser identity matching `generic-lifecycle-v*` from trusted automatic writes.

## Parser design

Parser fingerprint:
`generic-lifecycle-v1.3`

New API:
`parseGenericLifecycleObservations()`

It returns an array of independent `GenericLifecycleParseResult` observations from one source email.

Backward compatibility remains through:
`parseGenericLifecycleEmail()`

The compatibility wrapper returns the first observation only. For a combined invoice+shipment email, invoice remains the primary observation to preserve the prior v1.2 top-level behavior.

One email remains one `source_emails` row. Multiple semantic facts are stored inside:
- `generic_lifecycle_observations`
- `generic_lifecycle_observation_count`
- `generic_lifecycle_multi_observation`

Each nested observation remains REVIEW and carries explicit no-write flags.

Hard-link resolution still runs once per source email using only:
1. exact order number + exact merchant domain, or
2. unique exact tracking number already belonging to an existing Purchase shipment.

No domain+time fallback was added.

## Real reviewed patterns

### Irodamarket

A real recipient email contained all of:
- explicit order identity
- physical DPD courier handoff
- explicit parcel/tracking identity
- attached order invoice wording

v1.3 emits two observations:
- `invoice_or_receipt`
- `shipment:shipped`

### R-V Webshop

A real email contained:
- new electronic invoice wording
- exact order identity
- explicit courier handoff

The real pattern is covered by regression tests and emits separate invoice + shipped observations.

### eDuna

A real formal-Hungarian message used the form equivalent to:
`89445 számú rendelését átadtuk a futárnak`
and stated that the completed invoice was attached.

This required support for Hungarian pre-nominal order identity variants such as:
- `14107 számú rendelésed`
- `89445 számú rendelését`

## Additional parser hardening discovered during implementation

### Explicit handoff grammar

Irodamarket showed that nominative forms such as:
`rendelésed átadtuk a DPD futárszolgálatnak`
are explicit physical handoff evidence and should be `SHIPPED`, not merely `IN_TRANSIT`.

The handoff rule was expanded narrowly for these observed grammatical variants.

### Future invoice text remains non-evidence

A real current shipment remains valid, but explanatory wording such as:
`A számlát e-mailben küldjük, amikor ...`
does not create a second invoice observation.

The v1.2 future/prerequisite guard remains active.

## Persistence safety bug found before merge

The first implementation reused the first nested validated observation as the top-level validated result and then attached the observation array to it. That would have produced a circular JSON reference because the array contained its own parent object.

This was fixed before merge by introducing:
`buildGenericLifecycleValidatedEnvelope()`

The top-level compatibility envelope is now a shallow copy of the first observation while the nested observations remain separate objects.

Dedicated regressions prove:
- multi-observation envelope is JSON serializable
- single-observation envelope is JSON serializable
- impossible empty observation set is rejected

## Permanent test proof

Exact permanent runtime head before documentation:
`0b949bd5a0a9e1cd61740ac6cad8b4d0e1a24874`

CI #655:
- **723/723 API tests PASS**
- 0 fail
- API typecheck/build PASS
- mobile typecheck/build PASS

## Final live mailbox proof — PR #157

PR #157 was an audit-only branch and was closed without merge.

Exact audit run:
CI #657

Safety:
- Nylas read only
- Supabase Purchase/Shipment SELECT only
- 0 `source_emails` writes
- 0 `purchase_sources` writes
- 0 Purchase writes
- 0 Shipment writes
- 0 Document writes
- 0 production registry activation
- no raw email identity or purchase identifiers in CI output

Scope:
- **9,450 messages**
- 473 pages
- not truncated
- 9,449 messages with list-body content
- 1 full-message fetch
- 0 full-message fetch failures
- 29 provider retries
- 19 existing Purchases loaded read-only
- 16 existing Shipments loaded read-only

Final source/observation funnel:
- raw/fallback source emails: **24**
- total semantic observations: **25**
- one-observation source emails: **23**
- two-observation source emails: **1**
- multi-observation source emails: **1**
- distinct multi-observation sender fingerprints: **1**
- exact order+domain hard links: **1**
- exact tracking hard links: **0**
- ambiguity: **0**
- conflicts: **0**
- unmatched / REVIEW source emails: **23**

Observation mix:
- shipment: **18**
- invoice/receipt: **7**

Shipment phases:
- shipped: **13**
- in transit: **5**
- ready for pickup: **0**

The single live multi-observation source had the privacy-safe shape:
`invoice_or_receipt + shipment:shipped`
with both order and tracking hard identities. It aligns with the manually reviewed real Irodamarket email.

The known exact Sinsay order+domain hard link remained intact.

The previously fixed Oázis future-pickup and Klarstein future-handoff false positives did not reappear.

## v1.2 -> v1.3 interpretation

The rolling mailbox changed from 9,449 to 9,450 messages, so aggregate counts are not a perfect paired experiment.

v1.2 source emails: 20  
v1.3 source emails: 24  
v1.3 observations: 25

The source increase is controlled and comes from intentionally supported real Hungarian order/handoff language, not from duplicating each email into multiple source records.

The key architectural proof is:
- one source email remains one source record
- only one of 24 source emails produced multiple semantic observations
- exactly one extra observation was added (24 -> 25)
- hard-link count stayed 1
- ambiguity stayed 0
- conflict stayed 0
- all automatic write permissions remained off

## Next high-value task

After release, move away from parser-cleanup loops and start the next purchase-lifecycle domain: payment evidence and its safe linking boundaries, while keeping payment-only email incapable of creating a Purchase.
