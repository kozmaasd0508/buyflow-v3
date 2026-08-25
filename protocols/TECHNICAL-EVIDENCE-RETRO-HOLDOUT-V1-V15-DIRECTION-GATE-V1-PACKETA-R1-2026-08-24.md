# TechnicalEvidence v1.5 + Direction Gate v1 + Packeta R1 — Retro Holdout v1 targeted replay

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
- Raw Gmail IDs, addresses, order/tracking/invoice values and message content: not persisted here

## Baseline before Packeta R1

The previous Direction Gate v1 replay produced:

### Event authority

| Metric | Count |
|---|---:|
| True positive | 2 |
| False positive | 0 |
| False negative | 31 |
| True negative | 167 |
| Precision | 100.00% |
| Recall | 6.06% |
| F1 | 11.43% |

### Actionable TechnicalEvidence

| Metric | Count |
|---|---:|
| True positive | 5 |
| False positive | 0 |
| False negative | 28 |
| True negative | 167 |
| Precision | 100.00% |
| Recall | 15.15% |
| F1 | 26.32% |

The 0-FP state was achieved by preserving raw TechnicalEvidence while blocking seller-outbound and return-to-seller carrier evidence from buyer-Purchase authority.

## Why Packeta was the next recall target

The frozen retro characterization identified native Packeta buyer shipment mail as a real false-negative family.

The reviewed historical Packeta sample proves the family through narrow provider-qualified primitives:

- exact direct sender domain `packeta.hu`;
- exact accepted-for-transport subject;
- explicit buyer-bound shipment wording;
- explicit Packeta `Csomagszám` Z identifier;
- matching `tracking.packeta.com/?id=Z...` endpoint.

No merchant-specific subject or merchant identity is required.

## Packeta R1 authority contract

The adapter intentionally remains narrow:

1. `sender.primaryDomain` must equal `packeta.hu` exactly.
2. Marketing/newsletter subdomains such as `hirek.packeta.hu` are rejected.
3. Hard Z tracking identity requires at least two independent Packeta template primitives.
4. Every observed Z primitive must normalize to the exact same value.
5. Conflicting Z identifiers produce no hard tracking identity.
6. A single Z-looking token or URL is insufficient.
7. Shipment authority additionally requires the exact accepted-for-transport subject, provider tracking endpoint and one reviewed buyer-shipment semantic template.
8. Output remains shadow-only, 0 writes, 0 AI.

## Frozen-dataset impact cardinality

Before evaluating the delta, sender-only Gmail queries were run over the two already-frozen retro labels.

- Mixed 100: **1** direct `packeta.hu` message.
- Noise-enriched 100: **0** direct `packeta.hu` messages.

Because Packeta R1 exits immediately unless the exact direct sender domain is `packeta.hu`, **199 of 200 frozen cases are invariant to this adapter change**.

The one affected case is the previously known native Packeta buyer-shipment false negative. It is commerce ground truth and the existing Direction Gate classifies its explicit carrier wording as `buyer_inbound`, so the new Packeta event and hard tracking evidence remain Purchase-eligible.

No retro noise case enters the Packeta adapter.

## Targeted replay result

### Event authority after Direction Gate v1 + Packeta R1

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| True positive | 2 | **3** | +1 |
| False positive | 0 | **0** | 0 |
| False negative | 31 | **30** | -1 |
| True negative | 167 | **167** | 0 |
| Precision | 100.00% | **100.00%** | 0 pp |
| Recall | 6.06% | **9.09%** | +3.03 pp |
| F1 | 11.43% | **16.67%** | +5.24 pp |

### Actionable TechnicalEvidence after Direction Gate v1 + Packeta R1

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| True positive | 5 | **6** | +1 |
| False positive | 0 | **0** | 0 |
| False negative | 28 | **27** | -1 |
| True negative | 167 | **167** | 0 |
| Precision | 100.00% | **100.00%** | 0 pp |
| Recall | 15.15% | **18.18%** | +3.03 pp |
| F1 | 26.32% | **30.77%** | +4.45 pp |

## Safety result

The non-negotiable retro regression gate is preserved:

**known actionable false positives: 0 -> 0**

**known event false positives: 0 -> 0**

The recall gain is therefore precision-safe on this frozen historical benchmark.

This does NOT prove the Packeta rule will have 100% precision on future unseen mail. That claim belongs only to the future TechnicalEvidence Blind Holdout v3.

## Executable integration

Packeta R1 is not a disconnected helper. `technical-evidence-v1-5.ts` already composes `collectCarrierTechnicalEvidenceV1`, and a v1.5 regression test verifies that strict Packeta carrier, hard tracking and shipment evidence are visible through the executable composite collector.

Additional carrier regression tests cover:

- modern Packeta accepted-for-transport template;
- historical buyer-shipment template with `Csomagszám` + provider tracking endpoint;
- unrelated sender rejection;
- marketing subdomain rejection;
- one-primitive hard-ID rejection;
- conflicting Z-ID rejection.

## CI status — GREEN

Fresh repository CI validated the current Packeta R1 candidate through CI-only draft PR #262 / GitHub Actions run #955.

Validated branch head:

`7192bd438876464e7201c342df1296c64a790b3b`

Required checks:

- API typecheck: **PASS**;
- API tests: **PASS — 1101/1101**;
- API build: **PASS**;
- mobile typecheck: **PASS**;
- mobile web build: **PASS**.

The CI-only PR was closed without merge after capturing the result. It was never a production merge path.

Dependency-hygiene note: `npm install` reported three high-severity audit findings. They did not fail this workflow and are not evidence of a Packeta semantic regression, but they should be reviewed separately before production release hardening.

## Blind boundary

The historical Packeta message used here is regression-only and is permanently excluded from future blind evidence.

The active future blind protocol is:

`TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V3-2026-08-24.md`

Freeze snapshot:

`ca3ae62b358f7b7cdcde63a6e1c0960c54b49513`

Cutoff:

`2026-08-23T23:28:16Z` (`2026-08-24 01:28:16 Europe/Budapest`)

The first ID-only Gmail preflight after this cutoff returned **0 messages**, so no v3 candidate content has been inspected.

Only genuinely unseen post-v3-cutoff messages may enter that set.

## Next recall target

With the known precision gate still at 0 false positives, the next historical recall family to investigate is:

**MPL real tracking URLs under `/ugyfelszolgalat/nyomkovetes?ids=...`**

The same process applies:

`provider-qualified adapter -> regression tests -> retro-200 exact impact -> FP must stay 0 -> future blind remains untouched`
