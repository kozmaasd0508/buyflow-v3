# Unknown Webshop Challenge v2 — first blind baseline

Date: 2026-08-24

## Frozen code
Scored snapshot: `3743282d354a36c0752370094ea58aea38f5a3c5`

The candidate sets were frozen before their contents were read. No grammar or semantic rule was changed before this baseline was recorded.

## Sets

### Noise Set
60 incoming historical messages selected by a generic order-word query, with no merchant names in the selection query.

Post-freeze review showed the set is overwhelmingly promotional/newsletter noise. Full-body trigger audit found no occurrences of the frozen grammar's hard positive phrases checked for:
- `elküldve`
- `visszaigazol...`
- `sikeres fizetés`
- `sikertelen fizetés`
- `kézbesítve`
- `feladásra került`
- `átadtuk a futárnak`
- `rögzítettük`
- `megkaptuk`
- `számlája érkezett`
- `számlád elkészült`
- `visszatérítés`
- `visszaküldés`

This is a false-positive stress set. Technical HTML/CSS markers are allowed to exist as evidence, but the Universal Semantic Layer deliberately gives technical-only evidence no decision authority.

### Transaction-Enriched Set
10 incoming historical messages selected before reading content using generic transactional structure terms only.

Post-freeze ground-truth composition:
- 7 promotion/service/non-retail billing messages
- 1 real invoice message from an unknown merchant family
- 2 real shipment lifecycle messages from another unknown merchant family (one automated shipment mail, one human support reply that independently confirms the parcel had already been handed off)

Repository search found no merchant-specific `takoy` or `jatekshop.hu` rule, so these cases qualify as unknown-merchant examples for this smoke baseline.

## Frozen-rule replay

### Unknown merchant shipment — Takoy
The automated mail subject contains a generic order identity plus completed dispatch wording (`megrendelés ... elküldve`). The frozen Universal Commerce Grammar therefore resolves `shipped` without knowing the merchant name.

The raw HTML independently contains generic order-structure markers such as `order-details`, while the visible layer already contains the ORDER concept. The Semantic Layer therefore provides cross-layer ORDER corroboration without owning the lifecycle decision.

Result: **correct SHIPPED recognition**.

### Unknown merchant shipment support reply — Takoy
The reply subject still carries the order identity and shipped wording, and the newly authored message independently says the parcel had already been sent for delivery.

Result: **correct SHIPPED recognition**. This remains lifecycle evidence, not a new Purchase.

### Unknown merchant invoice — Jatekshop
The message clearly says an invoice is being sent as an attached PDF, but the frozen grammar's invoice event phrases are narrower (`számla ... érkezett / elkészült / kiállítva / csatolva`).

The Semantic Layer sees the INVOICE object, but there is not yet a strong semantic composition rule that turns `INVOICE + attached PDF + sent/available wording` into an invoice event.

Result: **miss / REVIEW**.

## First v2 smoke score
This is intentionally a small blind smoke baseline, not an accuracy claim.

Unknown-merchant transactional cases: **3**
- correctly recognized: **2**
- missed: **1**
- wrong lifecycle promotion: **0**

Coverage on this tiny transaction sample: **66.7% (2/3)**.

Non-purchase/service cases in the transaction-enriched set: **7**
- observed false automatic lifecycle promotions: **0**

Noise Set: **60** promotional/newsletter messages. The full-body hard-trigger audit found **0 frozen hard positive phrase hits** among the checked grammar families. This is a safety preflight, not a full exact runner metric.

## What this proves
1. The universal direction is real: an unknown merchant shipment can be recognized without a named adapter.
2. Visible-language and technical HTML evidence can corroborate the same ORDER meaning independently.
3. Technical HTML evidence remains subordinate; it cannot create a lifecycle event by itself.
4. A real generic gap remains around invoice availability/sending semantics.

## Next universal step
Do not add a Jatekshop rule.

Add a semantic composition layer that can reason from evidence such as:
- `INVOICE` object
- PDF attachment present
- visible attached/sent/available wording
- no contradictory proforma/cancellation language

Then map that composition to a canonical invoice event.

After that change, validate on a **new unseen holdout**, not these v2 cases. These v2 messages are now regression-only.