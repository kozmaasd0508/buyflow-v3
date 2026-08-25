# TechnicalEvidence v1.5 + Direction Gate v1 + Packeta R1 + MPL R1 — Retro Holdout v1 targeted replay

Date: 2026-08-24

## Status

This is a **targeted deterministic regression replay over the frozen historical 200-message Retro Holdout v1**.

It is NOT a fresh blind/generalization result and it is NOT production accuracy.

- Runtime AI calls: 0
- Production writes: 0
- Dataset: frozen 200 cases
- Ground truth: 33 commerce / 167 noise
- Mixed: 30 commerce / 70 noise
- Noise-enriched: 3 commerce / 97 noise
- Raw Gmail IDs, addresses, names, order/tracking/invoice values, amounts and message content: not persisted here

## Baseline before MPL R1

After Direction Gate v1 + Packeta R1:

### Event authority

| Metric | Count |
|---|---:|
| True positive | 3 |
| False positive | 0 |
| False negative | 30 |
| True negative | 167 |
| Precision | 100.00% |
| Recall | 9.09% |
| F1 | 16.67% |

### Actionable TechnicalEvidence

| Metric | Count |
|---|---:|
| True positive | 6 |
| False positive | 0 |
| False negative | 27 |
| True negative | 167 |
| Precision | 100.00% |
| Recall | 18.18% |
| F1 | 30.77% |

## Why MPL was the next recall target

The original frozen v1.5 manual replay explicitly identified real MPL/Posta recipient lifecycle mail as a false-negative family because the executable TechnicalEvidence URL layer recognized only the narrower legacy endpoint:

`/nyomkovetes/nyitooldal?ids=...`

The reviewed real MPL templates in the retro set instead use:

`/ugyfelszolgalat/nyomkovetes?ids=...`

The messages also provide an explicit same-message `Küldeményazonosító:` field and direct `posta.hu` transport.

## Frozen-dataset impact characterization

Sender-only queries over the already-frozen retro labels were performed before the MPL R1 delta was scored.

- Mixed 100: **10** direct `posta.hu` messages.
- Noise-enriched 100: **0** direct `posta.hu` messages.

The ten direct Posta messages break down into:

- 1 recipient pre-advice / parcel-posted template;
- 2 international parcel arrived-in-country templates;
- 3 courier-today / out-for-delivery templates;
- 2 post-office ready-for-pickup templates;
- 2 post-delivery satisfaction survey messages.

MPL R1 grants shipment-family event authority only to the first eight reviewed buyer-inbound lifecycle messages.

The two survey messages remain non-actionable in the real retro samples: they contain an official tracking URL but do **not** contain the explicit `Küldeményazonosító:` field required for hard tracking, and MPL R1 has no survey/delivery event rule.

Because MPL R1 exits immediately unless `sender.primaryDomain === 'posta.hu'`, **190 of 200 frozen cases are invariant** to the MPL carrier adapter change.

## MPL R1 authority contract

1. Direct sender domain must equal `posta.hu` exactly.
2. Merchant relays and lookalike domains cannot inherit MPL authority.
3. Hard tracking identity is namespaced `MPL`.
4. Hard tracking requires both:
   - explicit `Küldeményazonosító:` / `Nemzetközi Küldeményazonosító:` field; and
   - official Posta tracking URL carrying the exact same `ids` value.
5. Supported official tracking endpoints are restricted to:
   - `/ugyfelszolgalat/nyomkovetes?ids=...`
   - `/nyomkovetes/nyitooldal?ids=...`
6. A single identifier primitive is insufficient.
7. Conflicting labelled and URL identifiers produce no hard tracking identity.
8. Event authority additionally requires the hard MPL identity plus one reviewed same-message buyer lifecycle template.
9. `Csomagja a kézbesítőnél van` is shipment-family evidence, never delivered.
10. `Csomagja érkezett` / post pickup availability is shipment-family evidence, never delivered.
11. Satisfaction survey / feedback mail receives no MPL R1 lifecycle event authority.
12. Output remains shadow-only, 0 writes, 0 AI.

## Targeted replay result

Eight previously missed MPL buyer lifecycle cases become supported. No known noise case enters the new MPL authority path.

### Event authority after MPL R1

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| True positive | 3 | **11** | +8 |
| False positive | 0 | **0** | 0 |
| False negative | 30 | **22** | -8 |
| True negative | 167 | **167** | 0 |
| Precision | 100.00% | **100.00%** | 0 pp |
| Recall | 9.09% | **33.33%** | +24.24 pp |
| F1 | 16.67% | **50.00%** | +33.33 pp |

### Actionable TechnicalEvidence after MPL R1

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| True positive | 6 | **14** | +8 |
| False positive | 0 | **0** | 0 |
| False negative | 27 | **19** | -8 |
| True negative | 167 | **167** | 0 |
| Precision | 100.00% | **100.00%** | 0 pp |
| Recall | 18.18% | **42.42%** | +24.24 pp |
| F1 | 30.77% | **59.57%** | +28.80 pp |

## Safety result

The non-negotiable historical regression gate is preserved:

**known event false positives: 0 -> 0**

**known actionable false positives: 0 -> 0**

This is a precision-safe recall gain on this frozen historical benchmark only. It does NOT prove 100% precision on future unseen mail.

## Executable integration

MPL R1 is integrated through the already-executable TechnicalEvidence v1.5 collector because `technical-evidence-v1-5.ts` composes `collectCarrierTechnicalEvidenceV1`.

The dedicated MPL R1 regression suite covers:

- direct Posta pre-advice;
- arrived-in-country recipient lifecycle;
- courier-today lifecycle;
- post-office pickup-ready lifecycle;
- wrong sender rejection;
- single-primitive hard-ID rejection;
- conflicting ID rejection;
- survey/feedback event rejection;
- legacy `nyitooldal` endpoint compatibility;
- v1.5 composite visibility;
- Direction Gate buyer-inbound eligibility.

## Full repository CI

CI-only draft PR #262 / GitHub Actions run #958 validated exact head:

`58f234c63aa873794767eaaed58892a78b309298`

PASS:

- API typecheck;
- API tests **1108/1108**;
- API build;
- mobile typecheck;
- mobile web build.

PR #262 was closed without merge after validation.

Dependency hygiene remains separate: `npm install` reports 3 high-severity audit findings, but they did not fail this CI run.

## Blind boundary

MPL R1 changes evidence/authority behavior after Blind Holdout v3 was frozen. Therefore v3 is superseded before any v3 candidate content was inspected.

The next untouched future generalization protocol is **Blind Holdout v4**, frozen at the validated MPL R1 code/test snapshot.

## Next historical recall candidates

If historical tuning continues, candidates from the frozen manual replay include:

- REGIO / `SiteEngine(c)GreyMatter` lifecycle;
- authenticated Shoprenter transport families;
- Temu provider identifiers + carrier lifecycle;
- Vinted buyer logistics;
- AWGifts custom order/shipment semantics;
- Frogpack/PPL shipment + invoice families.

Each future evidence change must preserve the same sequence:

`provider-qualified evidence -> negative tests -> retro impact -> FP must stay 0 -> full CI -> new blind freeze version`.
