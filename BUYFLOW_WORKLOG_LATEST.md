# BuyFlow worklog latest

Current TechnicalEvidence branch: `codex/technical-evidence-shadow-v1`

Development PR: #256 -> `codex/mailgun-inbound-shadow-v3`

Mode: shadow/read-only, 0 production writes, 0 AI calls, no runtime/DB/Purchase Identity Graph authority.

## 2026-08-24 — Direction Gate + Packeta R1 + MPL R1

### Retro-200 frozen historical benchmark

Ground truth:
- total: 200
- commerce: 33
- noise: 167

Historical regression only; NOT fresh blind accuracy.

### Direction Gate v1

After gate:
- Event: TP 2 / FP 0 / FN 31 / TN 167
- Actionable TE: TP 5 / FP 0 / FN 28 / TN 167
- known actionable FP: **10 -> 0**

### Packeta R1

After Packeta:
- Event: TP 3 / FP 0 / FN 30 / TN 167
- Actionable TE: TP 6 / FP 0 / FN 27 / TN 167

### MPL R1

Added strict direct-Posta buyer lifecycle TechnicalEvidence.

Implementation:
- `apps/api/src/extraction-v2/technical-evidence-carrier-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-direction-gate-v1.ts`
- `apps/api/src/extraction-v2/technical-evidence-mpl-r1.test.ts`

Authority contract:
- exact `posta.hu` sender domain;
- `MPL` namespace;
- hard tracking only from explicit labelled `Küldeményazonosító` + matching official Posta `ids=` URL;
- supports `/ugyfelszolgalat/nyomkovetes` and legacy `/nyomkovetes/nyitooldal`;
- conflicting or single primitive fails closed;
- event additionally requires one reviewed buyer-inbound lifecycle template;
- supported event families: posted/pre-advice, arrived-in-country, courier-today, post-office pickup-ready;
- courier-today / pickup-ready never DELIVERED;
- satisfaction survey receives no MPL R1 event authority.

Frozen retro cardinality:
- Mixed 100: 10 direct Posta
- NoiseEnriched 100: 0 direct Posta
- 8 supported buyer lifecycle messages
- 2 survey messages remain non-actionable in the observed samples
- 190/200 cases excluded by sender gate

Targeted retro result after Packeta R1 + MPL R1:
- Event: **TP 11 / FP 0 / FN 22 / TN 167**, precision **100.00%**, recall **33.33%**, F1 **50.00%**
- Actionable TE: **TP 14 / FP 0 / FN 19 / TN 167**, precision **100.00%**, recall **42.42%**, F1 **59.57%**
- known FP remains **0**

Report:
`protocols/TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-V15-DIRECTION-GATE-V1-PACKETA-R1-MPL-R1-2026-08-24.md`

### CI — GREEN

CI-only draft PR #262 executed GitHub Actions run #958 and was closed without merge.

Validated exact head:
`58f234c63aa873794767eaaed58892a78b309298`

PASS:
- API typecheck
- API tests **1108/1108**
- API build
- mobile typecheck
- mobile web build

Dependency note: `npm install` still reports 3 high-severity audit findings; separate release-hardening task.

### Active future blind protocol — v4

`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V4-2026-08-24.md`

Freeze code/test snapshot:
`58f234c63aa873794767eaaed58892a78b309298`

Cutoff:
`2026-08-24T18:09:49Z` / `2026-08-24 20:09:49 Europe/Budapest`

First Gmail ID-only preflight after exact cutoff: **0 messages**.

No v4 candidate content or predictions inspected. v4 remains untouched.

Any new evidence/authority logic before the first v4 prediction requires a new blind version.

## Existing TechnicalEvidence stack retained

- v1/v1.1/v1.2 multi-layer technical evidence
- executable v1.5 composite collector
- native Shopify transactional shadow adapter
- deterministic PDF invoice evidence
- GLS COD PDF payment/parcel evidence
- DPD lifecycle/parcel semantics
- FOXPOST lifecycle/dual-id semantics
- Packeta R1 lifecycle/Z-id semantics
- MPL R1 lifecycle/tracking semantics
- Direction Gate v1
- QR policy: pickup/action-code corroboration only, never generic tracking

## Next fork

Option A — preserve Blind v4:
- no evidence/authority changes;
- wait for genuinely new post-cutoff messages;
- human GT before predictions.

Option B — continue historical recall tuning:
- next candidates: REGIO/SiteEngine, authenticated Shoprenter, Temu, Vinted, AWGifts, Frogpack/PPL;
- provider-qualified evidence -> negative tests -> retro impact -> FP must stay 0 -> full CI -> new blind freeze.
