# TechnicalEvidence v1.5 + Direction Gate v1 — Retro Holdout v1 replay

Date: 2026-08-24

## Status

This is a **manual deterministic rule replay over the same frozen 200-message Retro Holdout v1**. It is not a claim that GitHub Actions executed the private Gmail messages.

The TechnicalEvidence v1.5 collector and Source Role / Direction Gate v1 code are repository-CI validated. The Gmail connector and GitHub Actions runtime still do not share a direct private-message data channel, so the 200-case result below is obtained by replaying the frozen rules against the already-frozen human truth and verified trigger families.

No ground-truth case, v1.5 extractor rule, or recall adapter was changed for this replay.

- Runtime AI calls: 0
- Production writes: 0
- Dataset: frozen 200 cases
- Ground truth: 33 commerce / 167 noise
- Mixed: 30 commerce / 70 noise
- Noise-enriched: 3 commerce / 97 noise
- Raw Gmail IDs, addresses, order/tracking/invoice values and message content: not persisted here

## Gate purpose

Direction Gate v1 is a **negative Purchase-authority safety gate**, not a new recognizer.

It retains raw TechnicalEvidence for runtime audit but prevents buyer-Purchase authority when a direct-carrier message strongly proves either:

- `seller_outbound`, or
- `return_to_seller`.

Direct-carrier evidence that is `buyer_inbound` remains eligible. `unknown` also remains eligible in v1 so this first safety layer does not reduce recall merely because a provider lacks a proven direction template.

The gate activates only when provider-qualified `carrier_semantic` evidence exists; merchant mail quoting carrier language cannot be reclassified by text alone.

## CI validation

Exact gate head validated by temporary CI-only PR #261, which was closed without merge.

Validated head before this report commit:

`d8887f04f2ba74fbb5ecedac3945c96b92f9e95b`

GitHub Actions CI run #947:

- API typecheck: PASS
- API tests: PASS — 1096/1096
- API build: PASS
- Mobile typecheck: PASS
- Mobile web build: PASS

The first CI attempt exposed one narrow Hungarian inflection bug around `árufelvételi megbízást`; the regex was corrected without changing GT, v1.5 extraction, or buyer-inbound authority. The second exact run is fully green.

## Baseline: frozen v1.5 replay

### Event authority

| Metric | Count |
|---|---:|
| True positive | 2 |
| False positive | 5 |
| False negative | 31 |
| True negative | 162 |
| Precision | 28.57% |
| Recall | 6.06% |
| F1 | 10.00% |

### Actionable technical evidence

| Metric | Count |
|---|---:|
| True positive | 5 |
| False positive | 10 |
| False negative | 28 |
| True negative | 157 |
| Precision | 33.33% |
| Recall | 15.15% |
| F1 | 20.83% |

## Direction-gated replay

### Event authority after Direction Gate v1

| Metric | Count |
|---|---:|
| True positive | 2 |
| False positive | 0 |
| False negative | 31 |
| True negative | 167 |
| Precision | 100.00% |
| Recall | 6.06% |
| F1 | 11.43% |

All five baseline event false positives were the same seller-side FOXPOST `Tömeges csomagfeladás visszaigazolása` family. Direct-carrier source + explicit self-service sender/dropoff wording classifies these as `seller_outbound`, so their generic HTML-title shipment evidence remains auditable but is not eligible for buyer Purchase lifecycle authority.

### Actionable technical evidence after Direction Gate v1

| Metric | Count |
|---|---:|
| True positive | 5 |
| False positive | 0 |
| False negative | 28 |
| True negative | 167 |
| Precision | 100.00% |
| Recall | 15.15% |
| F1 | 26.32% |

The other five baseline false positives were direct FOXPOST return-to-seller messages containing genuine parcel identifiers. Direct-carrier source + explicit undelivered/returned-to-sender semantics classifies them as `return_to_seller`, so their tracking identifiers remain in raw TechnicalEvidence but are blocked from buyer Purchase authority.

## Delta

| Metric | v1.5 | v1.5 + Direction Gate v1 | Delta |
|---|---:|---:|---:|
| Actionable TP | 5 | 5 | 0 |
| Actionable FP | 10 | 0 | -10 |
| Actionable precision | 33.33% | 100.00% | +66.67 pp |
| Actionable recall | 15.15% | 15.15% | 0 pp |
| Actionable F1 | 20.83% | 26.32% | +5.49 pp |
| Event FP | 5 | 0 | -5 |
| Event precision | 28.57% | 100.00% | +71.43 pp |

The five known true-positive actionable cases remain eligible:

- buyer-side FOXPOST warehouse tracking
- Express One physical-inbound shipment + air-waybill evidence
- FOXPOST buyer pre-advice tracking identity
- FOXPOST buyer pickup tracking identity
- Számlázz.hu invoice event + invoice identity

## What this proves — and what it does not

This replay supports the design decision that **source role and direction must gate Purchase authority before TechnicalEvidence can safely participate in buyer purchase lifecycle decisions**.

It does **not** prove production readiness:

- Recall remains only 15.15% on actionable evidence.
- `unknown` direction remains eligible in v1; this is deliberately conservative for recall and is not a complete ownership proof.
- The replay is historical and manual-deterministic, not a future unseen Gmail runtime execution.
- TechnicalEvidence remains shadow-only and must not replace the current production parser.

## Next step

With the benchmark's known precision failure blocked, recall can now be expanded one family at a time without changing the frozen GT:

1. Packeta native lifecycle / `tracking.packeta.com/?id=Z...`
2. MPL real `/ugyfelszolgalat/nyomkovetes?ids=...`
3. PrestaShop / `id_order`
4. Shoprenter authenticated transport
5. Temu namespaced order + carrier lifecycle
6. AWGifts / Frogpack / Vinted remaining families

Every recall adapter must be followed by the same 200-case replay, with the non-negotiable gate that false positives must not regress.

## Safety invariant

`technical evidence -> source role / direction eligibility -> Purchase authority -> identity/conflict gates`

Never:

`technical cue -> Purchase lifecycle event`

Precision remains the primary gate.