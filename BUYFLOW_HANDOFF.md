# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub state before changing runtime code.

**Last updated:** 2026-08-24 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Active development base:** `codex/mailgun-inbound-shadow-v3`  
**TechnicalEvidence branch:** `codex/technical-evidence-shadow-v1`  
**Development PR:** #256 -> `codex/mailgun-inbound-shadow-v3`

## CURRENT STATE

TechnicalEvidence is still shadow/read-only:
- 0 production writes
- 0 AI/LLM calls
- no DB mutation
- no automatic Purchase/Shipment create/link
- no Purchase Identity Graph decision authority
- ambiguity/conflict -> REVIEW/PENDING
- hard identifiers remain namespace-scoped

Executable collector:
`apps/api/src/extraction-v2/technical-evidence-v1-5.ts`

Purchase-direction safety gate:
`apps/api/src/extraction-v2/technical-evidence-direction-gate-v1.ts`

Current evidence families include:
- base v1.2 layers
- DPD / FOXPOST / Packeta / MPL
- native Shopify
- REGIO / SiteEngine R1
- deterministic PDF invoice
- GLS COD PDF evidence

## RETRO-200 CURRENT BASELINE

Frozen historical set:
- total 200
- commerce 33
- noise 167

Historical regression only, NOT fresh blind accuracy.

Progress:
- before Direction Gate: actionable TP 5 / FP 10
- after Direction Gate: actionable TP 5 / FP 0
- after Packeta R1: actionable TP 6 / FP 0
- after MPL R1: actionable TP 14 / FP 0
- after REGIO R1: actionable **TP 17 / FP 0 / FN 16 / TN 167**

Current actionable precision on this frozen historical set: **100.00%**  
Current actionable recall: **51.52%**  
Current actionable F1: **68.00%**

Current event result after REGIO R1:
- TP **14**
- FP **0**
- FN **19**
- TN **167**
- recall **42.42%**

Report:
`protocols/TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-V15-DIRECTION-GATE-V1-PACKETA-R1-MPL-R1-REGIO-R1-2026-08-24.md`

## REGIO / SITEENGINE R1 — COMPLETED

Implementation:
- `apps/api/src/extraction-v2/technical-evidence-regio-v1.ts`
- wired into `technical-evidence-v1-5.ts`
- tests: `technical-evidence-regio-v1.test.ts`

Strict authority contract:
- exact `regiojatek.hu` direct sender
- matching DKIM pass
- SiteEngine(c)GreyMatter MIME boundary
- one unique `WS .../...` order identity
- subject/body order identity must agree
- event needs one reviewed current REGIO lifecycle template

Supported R1 lifecycle:
- order received/recorded -> order_created
- fulfillment processing started -> order_processing
- explicit carrier handoff -> shipment

Important negative:
a real REGIO survey from the same authenticated sender/platform and with the same order number remains non-actionable because it has no supported current lifecycle event.

Frozen retro cardinality:
- Mixed: 3 REGIO transactional messages
- NoiseEnriched: 0 REGIO messages
- all 3 were previous false negatives and are now recognized
- 197/200 cases are outside the REGIO sender scope

## CI — REGIO R1 GREEN

GitHub Actions run **#960** validated exact code/test head:
`e13ef747f8f622cf88d5c9f647c324a197569522`

PASS:
- API typecheck
- API tests **1114/1114 PASS**
- API build
- mobile typecheck
- mobile web build

CI-only draft PR #262 was closed **without merge**.

Dependency-hygiene note remains: npm install reports 3 high-severity audit findings; separate release-hardening task.

## ACTIVE FUTURE BLIND FREEZE — V5

Protocol:
`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V5-2026-08-24.md`

Exact freeze snapshot:
`e13ef747f8f622cf88d5c9f647c324a197569522`

Cutoff:
`2026-08-24T18:23:26Z`  
`2026-08-24 20:23:26 Europe/Budapest`

First Gmail ID-only preflight strictly after cutoff: **0 messages**.
No post-cutoff content or predictions were inspected. v5 is untouched.

Any evidence/authority logic change before first v5 prediction requires another blind version.

## IMPORTANT SAFETY RULES

- seller-outbound / return-to-seller evidence cannot influence buyer Purchase authority
- future shipment wording is not current physical shipment
- pre-advice is not physical progress
- READY_FOR_PICKUP is not DELIVERED
- survey/review mail is not lifecycle proof by itself
- provider/platform identity alone is insufficient
- generic id/ids/code/ref is not hard identity without typed context
- conflicting hard identifiers never auto-merge
- payment-only evidence cannot create Purchase authority
- QR pickup/action code is not generic tracking

## NEXT HIGH-VALUE TASK

Next historical recall target if continuing tuning:
1. authenticated Shoprenter families
2. Temu
3. Vinted
4. AWGifts
5. Frogpack/PPL

Required sequence:
provider-qualified evidence -> negative tests -> retro-200 impact -> FP must remain 0 -> full CI -> new blind freeze.

## RESUME CONTRACT

Minimal resume phrase:
**Folytasd a BuyFlowot a GitHubból.**
