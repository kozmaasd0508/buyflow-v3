# BuyFlow worklog latest

Current TechnicalEvidence branch: `codex/technical-evidence-shadow-v1`

Development PR: #256 -> `codex/mailgun-inbound-shadow-v3`

Mode: shadow/read-only, 0 production writes, 0 AI calls, no runtime/DB/Purchase Identity Graph authority.

## 2026-08-24 — Direction Gate + Packeta R1 + MPL R1 + REGIO R1

### Frozen retro-200
- total 200
- commerce 33
- noise 167
- historical regression only, NOT fresh blind accuracy

### Progress
- before Direction Gate: actionable TP 5 / FP 10
- after Direction Gate: TP 5 / FP 0
- after Packeta R1: TP 6 / FP 0
- after MPL R1: TP 14 / FP 0
- after REGIO R1: **TP 17 / FP 0 / FN 16 / TN 167**

Current actionable metrics on frozen retro-200:
- precision 100.00%
- recall 51.52%
- F1 68.00%

Current event metrics:
- TP 14 / FP 0 / FN 19 / TN 167
- precision 100.00%
- recall 42.42%
- F1 59.57%

### REGIO R1

Real reviewed chain:
- order received/recorded
- fulfillment processing started
- explicit handoff to carrier

Safety boundary:
- exact `regiojatek.hu`
- DKIM pass required
- SiteEngine(c)GreyMatter MIME boundary required
- one unique explicit `WS .../...` order identity
- subject/body identity agreement required
- one exact current lifecycle template required

Critical negative control:
a real REGIO survey carries the same sender/platform family and an order number but receives no lifecycle/actionable evidence.

Frozen REGIO cardinality:
- Mixed: 3 transactional messages
- NoiseEnriched: 0
- all 3 were previous misses and are now recognized
- 197/200 cases outside sender scope

Implementation:
- `apps/api/src/extraction-v2/technical-evidence-regio-v1.ts`
- wired into `technical-evidence-v1-5.ts`
- tests: `technical-evidence-regio-v1.test.ts`

Report:
`protocols/TECHNICAL-EVIDENCE-RETRO-HOLDOUT-V1-V15-DIRECTION-GATE-V1-PACKETA-R1-MPL-R1-REGIO-R1-2026-08-24.md`

### CI — GREEN

GitHub Actions run #960 validated exact code/test head:
`e13ef747f8f622cf88d5c9f647c324a197569522`

PASS:
- API typecheck
- API tests **1114/1114**
- API build
- mobile typecheck
- mobile web build

CI-only PR #262 was closed without merge.

Dependency note: npm install still reports 3 high-severity audit findings; separate release-hardening task.

### Active future blind — v5

Protocol:
`protocols/TECHNICAL-EVIDENCE-BLIND-HOLDOUT-V5-2026-08-24.md`

Freeze snapshot:
`e13ef747f8f622cf88d5c9f647c324a197569522`

Cutoff:
`2026-08-24T18:23:26Z` / `2026-08-24 20:23:26 Europe/Budapest`

First strict post-cutoff Gmail ID-only preflight: **0 messages**.
No post-cutoff content or prediction inspected.

### Next recall targets
1. authenticated Shoprenter
2. Temu
3. Vinted
4. AWGifts
5. Frogpack/PPL

Every evidence change: strict provider proof -> negative tests -> frozen retro impact -> FP must stay 0 -> full CI -> new blind freeze.
