# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub state before changing runtime code.

**Last updated:** 2026-08-24 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Active development base:** `codex/mailgun-inbound-shadow-v3`  
**TechnicalEvidence branch:** `codex/technical-evidence-shadow-v1`  
**Development PR:** #256 -> `codex/mailgun-inbound-shadow-v3`

## CURRENT TECHNICALEVIDENCE STATE

TechnicalEvidence remains a separate observational lane.

It is NOT wired into production extraction authority, Purchase Identity Graph decision authority, DB mutation, Purchase/Shipment creation, or automatic linking.

Hard invariants:

- `mode=shadow`
- production writes = 0
- AI/LLM calls = 0
- namespace-scoped hard identity
- contradictions / ambiguity -> REVIEW/PENDING
- raw private Gmail values never committed to repo-safe reports
- lifecycle-only carrier evidence cannot create a Purchase

## EXECUTABLE STACK

Primary collector:

`apps/api/src/extraction-v2/technical-evidence-v1-5.ts`

Purchase-authority safety layer:

`apps/api/src/extraction-v2/technical-evidence-direction-gate-v1.ts`

Main provider/carrier layer:

`apps/api/src/extraction-v2/technical-evidence-carrier-v1.ts`

Current carrier semantics include authenticated/provider-qualified DPD, FOXPOST, Packeta and MPL evidence.

Required conceptual path:

```text
EmailDocument / deterministic attachment text
  -> collectTechnicalEvidenceV15
  -> applyTechnicalEvidenceDirectionGateV1
  -> downstream hard identity + conflict gates
  -> shadow decision only
```

Never:

```text
technical cue -> automatic Purchase write/link
```

## RETRO-200 — CURRENT REGRESSION BASELINE

Frozen historical set:

- total: **200**
- commerce ground truth: **33**
- noise ground truth: **167**

This is historical regression evidence, NOT fresh blind accuracy.

### Before Direction Gate v1

Actionable TechnicalEvidence:

- TP 5 / FP 10 / FN 28 / TN 157
- precision 33.33%
- recall 15.15%

### Direction Gate v1

Known actionable false positives: **10 -> 0**.

After Direction Gate v1:

- Event: TP 2 / FP 0 / FN 31 / TN 167
- Actionable: TP 5 / FP 0 / FN 28 / TN 167

### After Packeta R1

- Event: TP 3 / FP 0 / FN 30 / TN 167
- Actionable: TP 6 / FP 0 / FN 27 / TN 167

### After MPL R1 — CURRENT

- Event: **TP 11 / FP 0 / FN 22 / TN 167**
- Event precision **100.00%**, recall **33.33%**, F1 **50.00%**
- Actionable: **TP 14 / FP 0 / FN 19 / TN 167**
- Actionable precision **100.00%**, recall **42.42%**, F1 **59.57%**

Known event/actionable FP gate remains **0** on this historical benchmark.

Report:

`protocols/TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-V15-DIRECTION-GATE-V1-PACKETA-R1-MPL-R1-2026-08-24.md`

## MPL R1 — COMPLETED

Implementation commits:

- MPL carrier semantics: `0695b6f4ff820f47d1bb0bed6fa0691653854c02`
- MPL buyer direction: `5317370c74751f534c2899e71849d809ef5a83dc`
- MPL regression suite: `58f234c63aa873794767eaaed58892a78b309298`

Regression test file:

`apps/api/src/extraction-v2/technical-evidence-mpl-r1.test.ts`

### MPL authority contract

- exact direct `posta.hu` sender domain only;
- hard tracking namespace `MPL`;
- hard tracking requires explicit `Küldeményazonosító:` / `Nemzetközi Küldeményazonosító:` plus matching official Posta `ids=` tracking URL;
- supported official endpoints:
  - `/ugyfelszolgalat/nyomkovetes?ids=...`
  - `/nyomkovetes/nyitooldal?ids=...`
- one primitive alone -> no hard tracking;
- conflicting label/URL identity -> no hard tracking;
- event additionally requires hard MPL identity plus one reviewed buyer-inbound lifecycle template;
- supported R1 event families:
  - parcel posted to recipient / pre-advice;
  - parcel arrived in country;
  - courier-today / out-for-delivery;
  - ready for pickup at post office;
- courier-today and pickup-ready are never DELIVERED;
- satisfaction survey/feedback gets no R1 event authority.

### Retro impact cardinality

Frozen retro labels contained:

- Mixed 100: 10 direct `posta.hu`
- NoiseEnriched 100: 0 direct `posta.hu`

Of the 10 direct Posta messages:

- 8 are supported reviewed buyer lifecycle templates;
- 2 are satisfaction surveys and remain non-actionable in the observed samples because they lack the explicit labelled ID required for hard tracking and have no R1 event rule.

190/200 cases are excluded from the MPL adapter by sender gate.

## CI — MPL R1 GREEN

CI-only draft PR #262 was reopened only to execute the repository workflow and then closed **without merge**.

GitHub Actions run **#958** validated exact head:

`58f234c63aa873794767eaaed58892a78b309298`

PASS:

- API typecheck
- API tests **1108/1108**
- API build
- mobile typecheck
- mobile web build

Dependency-hygiene note remains: `npm install` reports **3 high-severity audit findings**. Separate release-hardening item.

## ACTIVE FUTURE BLIND FREEZE — V4

Protocol:

`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V4-2026-08-24.md`

Exact evidence/code-test snapshot:

`58f234c63aa873794767eaaed58892a78b309298`

Cutoff:

`2026-08-24T18:09:49Z`  
`2026-08-24 20:09:49 Europe/Budapest`

First post-cutoff Gmail **ID-only** preflight returned:

**0 messages**

No post-v4 candidate content or predictions have been inspected. v4 remains untouched.

Any future evidence-producing or authority-affecting change before the first v4 prediction requires a new blind freeze version.

## IMPORTANT SAFETY FINDINGS RETAINED

- DPD opaque myDPD `code=` is not tracking identity.
- FOXPOST pre-advice may establish parcel identity but does not prove physical shipment.
- FOXPOST/Packeta identifiers remain separate namespaces.
- QR payload from reviewed FOXPOST mail was pickup/opening code, not tracking identity.
- PDF filename alone is not proof.
- platform/provider identity alone cannot establish merchant identity.
- Shopify assets alone cannot grant lifecycle authority.
- future/conditional fulfillment wording cannot prove current lifecycle state.
- OUT_FOR_DELIVERY / READY_FOR_PICKUP are not DELIVERED.
- payment-only evidence cannot create Purchase authority.
- generic `id`, `ids`, `code`, `ref` are non-authoritative without typed provider context.
- direct-carrier seller-outbound/return-to-seller evidence is blocked from buyer-Purchase authority.

## NEXT HIGH-VALUE TASK

If continuing historical recall tuning, next candidates from the frozen manual replay include:

1. REGIO / `SiteEngine(c)GreyMatter` lifecycle;
2. authenticated Shoprenter transport families;
3. Temu provider identifiers + carrier lifecycle;
4. Vinted buyer logistics;
5. AWGifts custom order/shipment semantics;
6. Frogpack/PPL shipment + invoice families.

Required sequence remains:

```text
provider-qualified evidence
-> negative/adversarial tests
-> executable v1.5 coverage
-> retro-200 impact
-> FP must remain 0
-> full CI
-> new blind freeze version
```

If preserving v4 for true unseen evaluation, do not tune evidence logic further; collect only genuinely new post-cutoff messages and annotate human GT before exposing predictions.

## RESUME CONTRACT

Minimal resume phrase:

**Folytasd a BuyFlowot a GitHubból.**

Do not ask the user to retell project history when GitHub state can recover it.
