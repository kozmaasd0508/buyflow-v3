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
- frozen Extraction Engine v2 remains independent
- namespace-scoped hard identity
- contradictions / ambiguity -> REVIEW/PENDING
- raw private Gmail values never committed to repo-safe reports

## EXECUTABLE STACK

Primary collector:

`apps/api/src/extraction-v2/technical-evidence-v1-5.ts`

It composes:

- TechnicalEvidence v1.2 base layers;
- authenticated/provider-qualified carrier semantics;
- native Shopify transactional semantics;
- deterministic PDF invoice evidence;
- provider-qualified GLS COD PDF evidence.

Purchase-authority safety layer:

`apps/api/src/extraction-v2/technical-evidence-direction-gate-v1.ts`

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

This is historical regression/generalization evidence, NOT a fresh blind accuracy claim.

### Before Direction Gate v1

Actionable TechnicalEvidence:

- TP 5
- FP 10
- FN 28
- TN 157
- precision 33.33%
- recall 15.15%

### Direction Gate v1

The gate blocks strongly-proven seller-side carrier logistics and return-to-seller evidence from buyer-Purchase authority while preserving raw audit evidence.

After Direction Gate v1:

**Event authority**
- TP 2
- FP 0
- FN 31
- TN 167
- precision 100.00%
- recall 6.06%

**Actionable TechnicalEvidence**
- TP 5
- FP 0
- FN 28
- TN 167
- precision 100.00%
- recall 15.15%

Known actionable false positives: **10 -> 0**.

## PACKETA R1 — COMPLETED

Packeta was the first approved recall target after the Direction Gate.

Implementation:

`apps/api/src/extraction-v2/technical-evidence-carrier-v1.ts`

Regression tests:

`apps/api/src/extraction-v2/technical-evidence-carrier-v1.test.ts`

Composite v1.5 regression coverage:

`apps/api/src/extraction-v2/technical-evidence-v1-5.test.ts`

### Packeta authority contract

- exact `sender.primaryDomain === 'packeta.hu'` required;
- `hirek.packeta.hu` / marketing subdomains receive no carrier lifecycle authority;
- tracking namespace is `PACKETA`;
- hard Z identifier requires >=2 independent Packeta primitives;
- all present Z primitives must normalize to the same exact value;
- conflicting Z identifiers -> no hard tracking identity;
- one isolated Z-looking token or URL -> insufficient;
- supported identity primitives include explicit Z-number wording, `Csomagszám`, tracking-label wording, and exact Packeta tracking endpoint;
- shipment event additionally requires exact accepted-for-transport subject + reviewed buyer-shipment semantics + Packeta tracking endpoint;
- no merchant-specific subject hacks.

### Retro-200 Packeta impact

Sender-only cardinality over the frozen labels:

- Mixed 100: 1 direct `packeta.hu`
- Noise-enriched 100: 0 direct `packeta.hu`

Therefore 199/200 frozen cases are invariant to Packeta R1.

The one affected case was a previously-known native Packeta buyer-shipment false negative.

After Direction Gate v1 + Packeta R1:

**Event authority**
- TP **3**
- FP **0**
- FN **30**
- TN **167**
- precision **100.00%**
- recall **9.09%**
- F1 **16.67%**

**Actionable TechnicalEvidence**
- TP **6**
- FP **0**
- FN **27**
- TN **167**
- precision **100.00%**
- recall **18.18%**
- F1 **30.77%**

Known FP gate remains **0**.

Report:

`protocols/TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-V15-DIRECTION-GATE-V1-PACKETA-R1-2026-08-24.md`

## CI — PACKETA R1 GREEN

CI-only draft PR #262 was used only to execute the repository workflow against the current TechnicalEvidence head and was then closed **without merge**.

GitHub Actions:

- run **#955**
- validated branch head: `7192bd438876464e7201c342df1296c64a790b3b`
- API typecheck: PASS
- API tests: **1101/1101 PASS**
- API build: PASS
- mobile typecheck: PASS
- mobile web build: PASS

The workflow file was restored to its original `main` / PR-to-main trigger scope after the temporary validation attempt.

Dependency-hygiene note: `npm install` reported **3 high-severity audit findings**. They did not fail CI; inspect separately before production release hardening.

## ACTIVE FUTURE BLIND FREEZE — TECHNICALEVIDENCE V3

Protocol:

`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V3-2026-08-24.md`

Candidate freeze snapshot:

`ca3ae62b358f7b7cdcde63a6e1c0960c54b49513`

Cutoff:

`2026-08-23T23:28:16Z`  
`2026-08-24 01:28:16 Europe/Budapest`

First post-cutoff Gmail **ID-only** preflight returned:

**0 messages**

Therefore no v3 candidate content has been inspected.

Only messages received strictly after that cutoff and not inspected during development/retro work may enter the first v3 blind set.

If any evidence-producing or authority-affecting logic changes before first v3 prediction, version the blind freeze forward before inspecting new candidate content.

## IMPORTANT SAFETY FINDINGS RETAINED

- DPD opaque myDPD `code=` is not tracking identity.
- FOXPOST pre-advice may establish parcel identity but does not prove physical shipment.
- FOXPOST/Packeta identifiers remain separate namespaces.
- QR payload from the reviewed FOXPOST mail was a pickup/opening code, not tracking identity.
- PDF filename alone is not proof.
- platform/provider identity alone cannot establish merchant identity.
- Shopify assets alone cannot grant lifecycle authority.
- future/conditional fulfillment wording cannot prove current lifecycle state.
- OUT_FOR_DELIVERY / READY_FOR_PICKUP are not DELIVERED.
- payment-only evidence cannot create Purchase authority.
- generic `id`, `ids`, `code`, `ref` are non-authoritative without typed provider context.

## NEXT HIGH-VALUE TASK

Do not casually broaden Packeta; its current rule is intentionally narrow.

Next historical recall family, if continuing tuning before the first v3 blind result:

**MPL provider-qualified tracking/lifecycle evidence**, starting with real official tracking URLs around:

`/ugyfelszolgalat/nyomkovetes?ids=...`

Required process:

```text
inspect frozen retro misses
-> derive exact provider-qualified primitive
-> negative/adversarial tests
-> executable v1.5 coverage
-> retro-200 impact cardinality
-> FP must remain 0
-> full CI
-> version future blind freeze forward if evidence logic changed
```

If instead preserving v3 as the next true blind candidate, make no evidence/authority changes; wait for genuinely unseen post-cutoff messages and annotate GT before predictions.

## RESUME CONTRACT

Minimal resume phrase:

**Folytasd a BuyFlowot a GitHubból.**

Do not ask the user to retell project history when GitHub state can recover it.
